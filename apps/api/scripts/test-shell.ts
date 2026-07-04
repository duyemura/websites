/**
 * Site shell mini-pipeline — runs the real extract → segment → docgen pipeline
 * then builds nav + hero + footer using the exact same build stage functions.
 *
 * Usage (from apps/api):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/test-shell.ts <url>
 *
 * ~2-4 min first run, ~30s on subsequent runs (Playwright + LLM calls + astro build).
 * Output: opens compiled Astro dist in browser — byte-for-byte same as real build.
 */
import "dotenv/config";
import { chromium } from "playwright";
import { db as appDb, config as appConfig } from "../src/database";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import crypto from "crypto";

// ── Real pipeline stage functions ──────────────────────────────────────────
import { runExtractStage } from "../src/services/pipeline/extract-stage";
import { runSegmentStage } from "../src/services/pipeline/segment-stage";
import { runDocgenStage } from "../src/services/pipeline/docgen-stage";
import { loadArtifact } from "../src/utils/pipeline/artifact-store";
import { loadSectionVisualEvidenceDoc } from "../src/utils/section-visual-evidence-io";
import { loadDesignSystemDoc } from "../src/utils/design-system-io";
import { loadSiteHierarchyDoc } from "../src/utils/site-hierarchy-io";
import { getS3Client, ensureBuckets } from "../src/s3";
import {
  renderNavComponent,
  renderFooterComponent,
  writeProjectScaffold,
  relativizeAssetPaths,
  inlineCssIntoHtml,
  type FooterLinkGroup,
} from "../src/services/astro-code-generator";
import { renderVisualBlockWithFlag } from "../src/services/visual-section-renderer";
import { breakpointDeltasToTailwind } from "../src/utils/pipeline/breakpoint-tailwind";
import { saveSiteDocs } from "../src/utils/site-docs";
import type { DesignSystemV2, ResponsiveRule } from "../src/types/design-system-v2";
import type { HierarchySection } from "../src/types/site-hierarchy";
import type { SectionVisualEvidenceRow } from "../src/types/section-visual-evidence";
import type { ExtractedNav } from "../src/types/pipeline-artifacts";

// ── Args ──────────────────────────────────────────────────────────────────
const rawUrl = process.argv[2] ?? "https://www.torrancetraininglab.com/";
const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
const sourceDir = path.join(os.tmpdir(), "test-shell-build");
const distDir = path.join(sourceDir, "dist");

// config comes from ../src/database (appConfig)

// ── tsx __name patch ──────────────────────────────────────────────────────
const origLaunch = chromium.launch.bind(chromium);
chromium.launch = async (...args: Parameters<typeof chromium.launch>) => {
  const browser = await origLaunch(...args);
  const origNewCtx = browser.newContext.bind(browser);
  browser.newContext = async (...a: Parameters<typeof browser.newContext>) => {
    const ctx = await origNewCtx(...a);
    await ctx.addInitScript(() => { (globalThis as any).__name ??= (fn: unknown) => fn; });
    return ctx;
  };
  return browser;
};

function runProcess(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    child.on("error", reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔧 Shell mini-pipeline: ${url}`);
  console.log(`   URL: ${url}`);
  console.log("━".repeat(50));

  // ── DB + S3 ────────────────────────────────────────────────────────────
  const db = appDb;
  const config = appConfig;
  const s3 = getS3Client({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY });
  try { await ensureBuckets(s3, config); } catch { /* non-fatal */ }

  // Use the eval workspace (same as the eval harness)
  const workspaceRow = await db.selectFrom("workspaces").select("uuid").where("slug", "=", "local").executeTakeFirst();
  const workspaceUuid = workspaceRow?.uuid ?? "8c969ddd-c7f6-47d5-96ee-a17640c7cc88";
  const siteSlug = `shell-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 10)}`;

  // Look up or create site by slug (reuses existing pipeline artifacts across runs)
  const existing = await db.selectFrom("sites").select("uuid").where("workspaceUuid", "=", workspaceUuid).where("slug", "=", siteSlug).executeTakeFirst();
  const siteUuid = existing?.uuid ?? (await db.insertInto("sites").values({ workspaceUuid, name: `Shell ${new URL(url).hostname}`, slug: siteSlug, sourceUrl: url, status: "draft", mode: "replication" }).returning("uuid").executeTakeFirstOrThrow()).uuid;
  console.log(`  Site: ${siteUuid} (${existing ? "existing" : "new"})`);
  const ctx = { db, s3, config, siteUuid, workspaceUuid };

  // ── Stage 1: Extract ───────────────────────────────────────────────────
  console.log("\n[1/4] Extract stage (Playwright)...");
  const extract = await runExtractStage({ ...ctx, url, pages: ["/"] });
  console.log(`  ✓ ${extract.pages.length} page(s), nav: ${extract.extractedNav ? "found" : "not found"}`);

  // ── Stage 2: Segment ───────────────────────────────────────────────────
  console.log("[2/4] Segment stage (screenshots + vision)...");
  const segment = await runSegmentStage({ ...ctx, pages: ["/"] });
  const sectionCount = segment.pages.reduce((n, p) => n + p.sections.length, 0);
  console.log(`  ✓ ${sectionCount} section(s) segmented`);

  // ── Stage 3: Docgen ────────────────────────────────────────────────────
  console.log("[3/4] Docgen stage (design system + evidence)...");
  const docs = await runDocgenStage({ ...ctx, mode: "replication" });
  await saveSiteDocs(db, workspaceUuid, docs, siteUuid);
  console.log(`  ✓ ${docs.length} docs generated`);

  // ── Load built artifacts ───────────────────────────────────────────────
  const designSystemDoc = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
  const designSystem = designSystemDoc as DesignSystemV2;
  const evidenceDoc = await loadSectionVisualEvidenceDoc(db, workspaceUuid, siteUuid);
  const nav = extract.extractedNav as ExtractedNav | undefined;

  console.log(`  Primary color: ${designSystem?.global?.tokens?.colors?.primary}`);
  console.log(`  Font: ${designSystem?.global?.tokens?.fonts?.heading}`);

  // ── Stage 4: Build shell ───────────────────────────────────────────────
  console.log("[4/4] Building shell (nav + hero + footer)...");

  // Nav — deterministic from extractedNav
  const navSource = nav ? renderNavComponent(nav) : "---\n---\n<nav>No nav</nav>";

  // Hero — load the real hierarchy section (has actual heading/body/cta from docgen)
  // then pair with the S3 segment screenshot for visual context
  const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
  const heroPage = segment.pages[0];
  const heroSegSection = heroPage?.sections.find(s => s.tag === "hero" || s.tag === "unknown") ?? heroPage?.sections[0];
  // Real hierarchy section has content.heading, content.body, content.cta populated by docgen
  const realHeroSection = hierarchy?.pages[0]?.sections.find(s => s.id === heroSegSection?.id)
    ?? hierarchy?.pages[0]?.sections.find(s => s.tag === "hero");
  let heroAstroSource = "";
  if (heroSegSection && evidenceDoc && realHeroSection) {
    const evidenceRow = evidenceDoc.rows.find(r => r.evidenceId === heroSegSection.id);
    if (evidenceRow?.screenshotUrl) {
      const { imageUrlToDataUri } = await import("../src/utils/pipeline/image-to-data-url");
      const s3ctx = { s3, bucket: config.S3_ASSETS_BUCKET, region: config.S3_REGION, endpoint: config.S3_ENDPOINT };
      const screenshotDataUri = await imageUrlToDataUri(evidenceRow.screenshotUrl, s3ctx);
      // Use the REAL hierarchy section — heading/body/cta/eyebrow from docgen, not empty
      const evidence: SectionVisualEvidenceRow = { evidenceId: realHeroSection.id, pageSlug: "index", sectionId: realHeroSection.id, screenshotUrl: screenshotDataUri, boundingBox: heroSegSection.boundingBox, computedStyles: [], domStyles: evidenceRow.domStyles };
      const rules: ResponsiveRule[] = designSystem?.responsive?.rules ?? [];
      console.log(`  Hero content: heading="${realHeroSection.content.heading?.slice(0,40)}", cta="${realHeroSection.content.cta?.label}"`);
      const result = await renderVisualBlockWithFlag({ section: realHeroSection, evidence, designSystem, tailwindInstructions: breakpointDeltasToTailwind(rules), config });
      heroAstroSource = result.code;
      console.log(`  Hero: ${result.isFallback ? "⚠ fallback" : `✓ LLM rendered (${result.code.length} chars)`}`);
    }
  }

  // Footer — extract rich structure from live DOM (columns, logo, social links)
  const footerBrowser = await chromium.launch();
  const footerCtx = await footerBrowser.newContext();
  await footerCtx.addInitScript(() => { (globalThis as any).__name ??= (fn: unknown) => fn; });
  const footerPage = await footerCtx.newPage();
  await footerPage.goto(url, { waitUntil: "domcontentloaded" });
  await footerPage.waitForTimeout(1500);

  const footerData = await footerPage.evaluate(() => {
    const getText = (el: Element | null) => el?.textContent?.trim() ?? "";
    const footer = document.querySelector("footer, [role='contentinfo'], [class*='footer']") as HTMLElement | null;
    if (!footer) return null;

    const s = getComputedStyle(footer);
    const logoImg = footer.querySelector("img") as HTMLImageElement | null;

    // Social links: look for anchor elements containing social media URLs
    const socialLinks: { platform: string; href: string }[] = [];
    for (const a of Array.from(footer.querySelectorAll("a[href]"))) {
      const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
      const platform = href.includes("facebook") ? "Facebook"
        : href.includes("instagram") ? "Instagram"
        : href.includes("twitter") || href.includes("x.com") ? "Twitter"
        : href.includes("youtube") ? "YouTube"
        : href.includes("linkedin") ? "LinkedIn"
        : null;
      if (platform) socialLinks.push({ platform, href });
    }

    // Address: look for address-like element or text with a zip code
    const addrEl = footer.querySelector("address, [class*='address'], [class*='location']") as HTMLElement | null;
    let address = addrEl ? getText(addrEl) : "";
    if (!address) {
      // Fallback: find any paragraph/div with a 5-digit zip
      for (const el of Array.from(footer.querySelectorAll("p, div, span"))) {
        const t = el.textContent?.trim() ?? "";
        if (/\d{5}/.test(t) && t.length < 100 && t.length > 5) { address = t; break; }
      }
    }

    // Link columns: find all containers that have a heading + at least 2 links.
    // Works generically: Webflow, Bootstrap, hand-coded, any framework.
    const linkGroups: { heading?: string; links: { label: string; href: string }[] }[] = [];
    const processedLinks = new Set<string>();
    const isSocialUrl = (h: string) => h.includes("facebook") || h.includes("instagram")
      || h.includes("twitter") || h.includes("youtube") || h.includes("linkedin");

    // Walk all divs in the footer, find those with a heading + multiple links
    const allDivs = Array.from(footer.querySelectorAll("div, section, nav, ul"));
    for (const col of allDivs) {
      const heading = col.querySelector(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,:scope > [class*='heading'],:scope > [class*='title'],[class*='footer-link-title']");
      if (!heading) continue;
      const links = Array.from(col.querySelectorAll("a[href]"))
        .map(a => ({ label: getText(a), href: (a as HTMLAnchorElement).getAttribute("href") ?? "" }))
        .filter(l => l.label && l.href && !isSocialUrl(l.href) && !processedLinks.has(l.label) && l.label.length < 60);
      if (links.length >= 2) {
        links.forEach(l => processedLinks.add(l.label));
        linkGroups.push({ heading: getText(heading), links });
      }
    }

    // Flat fallback if no groups found
    const flatLinks = linkGroups.length === 0
      ? Array.from(footer.querySelectorAll("a[href]"))
          .filter(a => { const h = (a as HTMLAnchorElement).getAttribute("href") ?? ""; return h && !h.includes("facebook") && !h.includes("instagram"); })
          .map(a => ({ label: getText(a), href: (a as HTMLAnchorElement).getAttribute("href") ?? "" }))
          .filter(l => l.label)
          .slice(0, 16)
      : [];

    const copyright = footer.textContent?.match(/©[^<\n]{0,120}/)?.[0]?.trim() ?? "";

    return {
      background: s.backgroundColor,
      textColor: s.color,
      brandName: logoImg?.alt || "",
      logoUrl: logoImg?.src || undefined,
      links: flatLinks,
      linkGroups,
      socialLinks,
      address,
      copyright,
    };
  });

  await footerPage.close();
  await footerCtx.close();
  await footerBrowser.close();

  console.log(`  Footer: bg=${footerData?.background}, groups=${footerData?.linkGroups?.length ?? 0}, social=${footerData?.socialLinks?.length ?? 0}`);

  const footerSource = footerData
    ? renderFooterComponent(footerData)
    : "---\n---\n<footer style='background:#00040d;padding:3rem'></footer>";

  // Write real Astro project
  const webFontUrls = extract.css.webFontUrls ?? [];
  await rm(sourceDir, { recursive: true, force: true });
  await writeProjectScaffold(sourceDir, designSystem, { webFontUrls });

  const sectionsDir = path.join(sourceDir, "src", "components", "sections");
  await mkdir(sectionsDir, { recursive: true });
  await writeFile(path.join(sourceDir, "src", "components", "shared", "Header.astro"), navSource);
  await writeFile(path.join(sourceDir, "src", "components", "shared", "Footer.astro"), footerSource);
  await writeFile(path.join(sectionsDir, "shell-hero.astro"), heroAstroSource || `---\n---\n<div style="min-height:500px;background:#1a1a2e"></div>`);

  const indexPage = `---
import Layout from "../layouts/Layout.astro";
import Hero from "../components/sections/shell-hero.astro";
---
<Layout title="${new URL(url).hostname}">
  <Hero />
  <div style="padding:3rem 2rem;text-align:center;background:#f8fafc;color:#94a3b8;border-top:1px dashed #e2e8f0">
    <strong style="display:block;color:#64748b;margin-bottom:0.5rem">Page content sections</strong>
    Full build renders all ${sectionCount} sections here
  </div>
</Layout>`;
  await writeFile(path.join(sourceDir, "src", "pages", "index.astro"), indexPage);

  await runProcess("pnpm", ["install"], sourceDir);
  await runProcess("pnpm", ["exec", "astro", "build"], sourceDir);
  await relativizeAssetPaths(distDir);
  await inlineCssIntoHtml(distDir);

  const outFile = path.join(distDir, "index.html");
  console.log(`\n✓ Built → ${outFile}`);
  const { exec } = await import("child_process");
  exec(`open "${outFile}"`);
}

main().catch(err => { console.error(err); process.exit(1); });
