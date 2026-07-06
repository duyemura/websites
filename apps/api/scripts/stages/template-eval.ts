// apps/api/scripts/stages/template-eval.ts
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { StageRunner, StageContext, StageResult } from "./types";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

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

    const failures: string[] = [];
    const visited = new Set<string>();
    const queue = ["/"];
    const browser = await chromium.launch();
    const page = await browser.newPage();

    while (queue.length > 0) {
      const route = queue.shift()!;
      if (visited.has(route)) continue;
      visited.add(route);

      const res = await page.goto(base + route, { waitUntil: "domcontentloaded" });
      if (!res || res.status() >= 400) {
        failures.push(`${route}: HTTP ${res?.status()}`);
        continue;
      }

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
      for (const e of ldErrors) failures.push(`${route}: ${e}`);

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
    }
    await browser.close();

    // Required discovery/SEO files
    for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "rss.xml"]) {
      if (!existsSync(path.join(distDir, f))) failures.push(`missing ${f}`);
    }

    server.close();

    ctx.log(`  Crawled ${visited.size} pages, ${failures.length} failures`);

    return {
      stage: "template-eval",
      status: failures.length > 0 ? "fail" : "pass",
      durationMs: Date.now() - start,
      metrics: {
        pagesCrawled: visited.size,
        failures: failures.length,
      },
      warnings: [],
      error: failures.length > 0 ? failures.slice(0, 5).join("; ") : undefined,
    };
  },
};
