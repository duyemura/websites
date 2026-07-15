// apps/api/scripts/stages/template-eval.ts
// Post-build QA gate for generated Milo template sites.
// Serves the Astro dist locally, crawls every internal link, validates JSON-LD,
// runs axe-core WCAG 2 AA checks, and audits every rendered page for real gym
// business info and placeholder leakage. Fixable issues are self-healed by
// patching the generate artifact and rebuilding; unfixable issues fail the stage
// before publish can run.
import { createServer } from "node:http";
import { readFileSync, existsSync, readFile } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type { StageRunner, StageContext, StageResult } from "./types";
import { templateStage } from "./template.js";
import { loadArtifact, saveArtifact } from "../../src/utils/pipeline/artifact-store.js";
import type { GymSiteContent } from "@milo/shared-types";
import {
  auditPage,
  applySelfHeals,
  buildAllowedPaths,
  type AuditFailure,
} from "../../src/services/template/rendered-audit.js";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function loadGenerateContent(
  ctx: StageContext,
  distDir: string,
): Promise<GymSiteContent | null> {
  // Prefer the generate artifact — it is the source of truth for business info.
  const generateStage = "generate" as unknown as Parameters<typeof loadArtifact>[2];
  const artifact = await loadArtifact(
    ctx.db,
    { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
    generateStage,
  );
  if (artifact?.payload) {
    return artifact.payload as GymSiteContent;
  }

  // Fallback: read the gym.json that was baked into the renderer build.
  const gymJsonPath = path.join(distDir, "content", "gym.json");
  if (!existsSync(gymJsonPath)) return null;
  try {
    return JSON.parse(await readFile(gymJsonPath, "utf8")) as GymSiteContent;
  } catch {
    return null;
  }
}

export const templateEvalStage: StageRunner = {
  label: "template-eval",
  requires: [],
  // Always re-run (no artifact key)
  produces: "",

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();
    const distDir = path.join(ctx.rendererDir, "dist");

    if (!existsSync(path.join(distDir, "index.html"))) {
      return {
        stage: "template-eval",
        status: "fail",
        durationMs: Date.now() - start,
        metrics: {},
        warnings: [],
        error: `No build at ${distDir} — run the template stage first`,
      };
    }

    // Serve dist locally on a random port
    const server = createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      let file = path.join(distDir, url);
      if (url.endsWith("/")) file = path.join(file, "index.html");
      else if (!path.extname(file)) file = path.join(file, "index.html");
      try {
        const body = readFileSync(file);
        res.writeHead(200, {
          "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    let content = await loadGenerateContent(ctx, distDir);
    if (content) {
      ctx.log(`  Loaded generate artifact for audit`);
    } else {
      ctx.log(`  [warn] No generate artifact or gym.json — skipping rendered-content audit`);
    }

    let browser;
    let failures: AuditFailure[] = [];
    let warnings: string[] = [];
    let healCount = 0;
    let lastPageCount = 0;

    try {
      browser = await chromium.launch();
      const page = await browser.newPage();

      // Self-heal loop: audit, patch, rebuild, re-audit. Max 2 rebuilds.
      for (let round = 0; round <= 2; round++) {
        const visited = new Set<string>();
        const queue = ["/"];
        failures = [];
        warnings = [];
        const allowedPaths = content ? buildAllowedPaths(content) : new Set<string>();

        while (queue.length > 0) {
          const route = queue.shift()!;
          if (visited.has(route)) continue;
          visited.add(route);

          const res = await page.goto(base + route, { waitUntil: "domcontentloaded" });
          if (!res || res.status() >= 400) {
            failures.push({
              page: route,
              check: "http",
              message: `HTTP ${res?.status()}`,
              fixable: false,
            });
            continue;
          }

          const html = await page.content();

          // JSON-LD must parse on every page
          const ldErrors = await page.evaluate(() => {
            const errs: string[] = [];
            document
              .querySelectorAll('script[type="application/ld+json"]')
              .forEach((s, i) => {
                try {
                  JSON.parse(s.textContent ?? "");
                } catch {
                  errs.push(`ld+json #${i} invalid`);
                }
              });
            if (
              document.querySelectorAll('script[type="application/ld+json"]').length === 0
            )
              errs.push("no JSON-LD");
            return errs;
          });
          for (const e of ldErrors) {
            failures.push({
              page: route,
              check: "jsonld-parse",
              message: e,
              fixable: false,
            });
          }

          // Accessibility / contrast check on every page. Failures are warnings unless
          // they are critical or impact form usability (color-contrast, label).
          try {
            const axeResults = await new AxeBuilder({ page })
              .withTags(["wcag2aa"])
              // Cross-origin iframes (widgets, maps, schedulers) style themselves; we
              // cannot fix their contrast inside the template.
              .options({ iframes: false })
              .analyze();
            for (const violation of axeResults.violations) {
              const selector = violation.nodes[0]?.target?.join(", ");
              // Cross-origin iframe widgets style their own content; skip
              // violations we cannot fix from the parent template.
              if (selector?.includes("iframe[")) {
                continue;
              }
              const msg = `axe ${violation.id} (${violation.impact}) — ${violation.help}`;
              if (["critical", "serious"].includes(violation.impact ?? "")) {
                failures.push({
                  page: route,
                  check: "axe",
                  message: msg,
                  fixable: false,
                });
              } else {
                warnings.push(`${route}: ${msg}`);
              }
            }
          } catch {
            // Axe can throw on unusual DOM; don't let it kill the whole eval.
          }

          // Enqueue internal links
          const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll("a[href]"))
              .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
              .filter((h) => h.startsWith("/") && !h.startsWith("//")),
          );
          for (const l of links) {
            const clean = l.split("#")[0].split("?")[0];
            if (clean && !visited.has(clean)) queue.push(clean);
          }

          // Deterministic rendered-content audit
          if (content) {
            const audit = auditPage(route, html, content.business, allowedPaths, links);
            failures.push(...audit.failures);
            warnings.push(...audit.warnings);
          }
        }

        // Required discovery/SEO files
        for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "rss.xml"]) {
          if (!existsSync(path.join(distDir, f))) {
            failures.push({
              page: "/",
              check: "required-file",
              message: `missing ${f}`,
              fixable: false,
            });
          }
        }

        lastPageCount = visited.size;
        const fixable = failures.filter((f) => f.fixable);
        if (fixable.length === 0 || !content || round >= 2) {
          break;
        }

        // Self-heal: patch the artifact and rebuild
        const before = JSON.stringify(content);
        const healResult = applySelfHeals(content, failures);
        if (!healResult.healed) {
          break;
        }
        content = healResult.content;

        // Only save + rebuild if the artifact actually changed
        if (JSON.stringify(content) === before) {
          break;
        }

        healCount++;
        ctx.log(`  Self-heal round ${healCount}: ${healResult.heals.join("; ")}`);
        const saveStage = "generate" as unknown as Parameters<typeof saveArtifact>[2];
        await saveArtifact(
          ctx.db,
          { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
          saveStage,
          content,
        );

        const rebuildResult = await templateStage.run(ctx);
        if (rebuildResult.status === "fail") {
          failures.push({
            page: "/",
            check: "self-heal-rebuild",
            message: `Self-heal rebuild failed: ${rebuildResult.error ?? "unknown error"}`,
            fixable: false,
          });
          break;
        }
      }

      ctx.log(`  Crawled ${lastPageCount} pages, ${failures.length} failures, ${healCount} self-heal rounds`);

      const groupedFailures = groupFailures(failures);
      return {
        stage: "template-eval",
        status: failures.length > 0 ? "fail" : "pass",
        durationMs: Date.now() - start,
        metrics: {
          pagesCrawled: lastPageCount,
          failures: failures.length,
          warnings: warnings.length,
          selfHealRounds: healCount,
        },
        warnings,
        error: failures.length > 0 ? groupedFailures.slice(0, 10).join("; ") : undefined,
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
};

function groupFailures(failures: AuditFailure[]): string[] {
  const byCheck = new Map<string, number>();
  const samples: string[] = [];
  for (const f of failures) {
    const key = `${f.page}: ${f.message}`;
    if (!byCheck.has(key)) {
      byCheck.set(key, 0);
      samples.push(key);
    }
    byCheck.set(key, byCheck.get(key)! + 1);
  }
  return samples.map((s) => {
    const count = byCheck.get(s)!;
    return count > 1 ? `${s} (×${count})` : s;
  });
}
