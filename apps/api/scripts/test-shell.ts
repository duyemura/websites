/**
 * Site shell mini-pipeline — rapid feedback for fixing nav/hero/footer rendering.
 *
 * Uses the EXACT same functions as the real build pipeline. Fixing a renderer
 * here fixes it in production. Re-runs in ~30-60s instead of 10+ minutes.
 *
 * Usage (from apps/api):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/test-shell.ts <url> [out.html]
 *
 * What it runs:
 *   1. Extract  — capturePage() + extractNavData() (Playwright)
 *   2. Segment  — runLadder() to find hero + footer section boundaries
 *   3. Design system — buildDesignSystemFromExtract() (same as real docgen)
 *   4. Nav      — renderNavComponent() (deterministic, same as build stage)
 *   5. Hero     — screenshot crop → renderVisualBlockWithFlag() (LLM, same as build)
 *   6. Footer   — extractFooterData() + renderFooterComponent() (deterministic)
 *   7. Output   — single HTML with page switcher
 */
import "dotenv/config";
import { chromium, type BrowserContext } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import os from "os";

// ── Same functions as the real pipeline ──────────────────────────────────
import { capturePage, extractNavData } from "../src/utils/pipeline/capture-page";
import { renderNavComponent, renderFooterComponent } from "../src/services/astro-code-generator";
import { buildDesignSystemFromExtract } from "../src/utils/design-system-builder";
import { renderVisualBlockWithFlag } from "../src/services/visual-section-renderer";
import { breakpointDeltasToTailwind } from "../src/utils/pipeline/breakpoint-tailwind";
import type { ExtractedNav, ExtractArtifact } from "../src/types/pipeline-artifacts";
import type { DesignSystemV2, ResponsiveRule } from "../src/types/design-system-v2";
import type { HierarchySection } from "../src/types/site-hierarchy";
import type { SectionVisualEvidenceRow } from "../src/types/section-visual-evidence";

// ── Minimal S3 stub (no uploads needed for test) ─────────────────────────
// Screenshots stay as local base64 data URIs.
const noopS3 = {} as any;
const noopConfig = {
  LLM_PROVIDER: (process.env.LLM_PROVIDER ?? "openrouter") as "openrouter" | "ollama",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY ?? "",
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  DEFAULT_LLM_MODEL: process.env.DEFAULT_LLM_MODEL ?? "google/gemini-2.5-flash",
  VISION_LLM_MODEL: process.env.VISION_LLM_MODEL ?? "google/gemini-2.5-flash",
  CHEAP_LLM_MODEL: process.env.CHEAP_LLM_MODEL ?? "google/gemini-2.5-flash",
  CODE_LLM_MODEL: process.env.CODE_LLM_MODEL ?? "google/gemini-2.5-flash",
  LONG_CONTEXT_LLM_MODEL: process.env.LONG_CONTEXT_LLM_MODEL ?? "google/gemini-2.5-flash",
  REASONING_LLM_MODEL: process.env.REASONING_LLM_MODEL ?? "google/gemini-2.5-flash",
  S3_ASSETS_BUCKET: process.env.S3_ASSETS_BUCKET ?? "",
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_DEPLOYMENTS_BUCKET: process.env.S3_DEPLOYMENTS_BUCKET,
} as any;

// ── Args ──────────────────────────────────────────────────────────────────
const rawUrl = process.argv[2] ?? "https://www.torrancetraininglab.com/";
const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
const out = process.argv[3] ?? "/tmp/test-shell.html";

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

// ── Footer extraction (Playwright) ───────────────────────────────────────
interface FooterData {
  background: string;
  textColor: string;
  brandName: string;
  logoUrl?: string;
  links: { label: string; href: string }[];
  copyright: string;
}

async function extractFooterData(ctx: BrowserContext, pageUrl: string): Promise<FooterData> {
  const page = await ctx.newPage();
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const data = await page.evaluate((): FooterData => {
    const getText = (el: Element | null) => el?.textContent?.trim() ?? "";
    const footer = document.querySelector("footer, [role='contentinfo'], [class*='footer']") as HTMLElement | null;
    if (!footer) return { background: "#1a1a1a", textColor: "#fff", brandName: "", links: [], copyright: "" };
    const s = getComputedStyle(footer);
    const imgEl = footer.querySelector("img") as HTMLImageElement | null;
    const links = Array.from(footer.querySelectorAll("a[href]"))
      .filter(a => { const h = (a as HTMLAnchorElement).getAttribute("href") ?? ""; return h && !h.startsWith("mailto:") && !h.startsWith("tel:"); })
      .map(a => ({ label: getText(a), href: (a as HTMLAnchorElement).getAttribute("href") ?? "" }))
      .filter(l => l.label)
      .slice(0, 16);
    const copyright = footer.textContent?.match(/©[^<\n]{0,100}/)?.[ 0]?.trim() ?? "";
    const brandEl = footer.querySelector("[class*='logo'],[class*='brand']") as HTMLElement | null;
    return {
      background: s.backgroundColor || "#1a1a1a",
      textColor: s.color || "#fff",
      brandName: imgEl?.alt || getText(brandEl) || "",
      logoUrl: imgEl?.src || undefined,
      links,
      copyright,
    };
  });
  await page.close();
  return data;
}

// ── Hero section rendering ────────────────────────────────────────────────
async function renderHeroSection(
  ctx: BrowserContext,
  pageUrl: string,
  designSystem: DesignSystemV2,
): Promise<{ html: string; isFallback: boolean }> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Scroll to trigger any lazy images
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  // Find the hero: prefer the first element with a background-image below the nav.
  // This is more reliable than the ladder for background-image-based heroes.
  const heroBbox = await page.evaluate((): { x:number; y:number; width:number; height:number } | null => {
    const navEl = document.querySelector('[role="banner"], header');
    const navBottom = navEl ? navEl.getBoundingClientRect().bottom + window.scrollY : 80;
    // Look for elements with background-image in the hero area
    const allEls = Array.from(document.querySelectorAll('section,[class*="hero"],[class*="banner"],main>div,body>div,div'));
    for (const el of allEls) {
      const r = el.getBoundingClientRect();
      const absTop = r.top + window.scrollY;
      if (absTop < navBottom - 5 || r.height < 200 || r.width < 800) continue;
      const s = getComputedStyle(el as Element);
      if (s.backgroundImage && s.backgroundImage !== 'none') {
        return { x: 0, y: Math.round(absTop), width: 1440, height: Math.round(r.height) };
      }
    }
    // Fallback: first large section below nav
    for (const el of allEls) {
      const r = el.getBoundingClientRect();
      const absTop = r.top + window.scrollY;
      if (absTop >= navBottom && r.height > 300 && r.width > 800) {
        return { x: 0, y: Math.round(absTop), width: 1440, height: Math.round(r.height) };
      }
    }
    return null;
  });

  const heroCand = heroBbox ? { boundingBox: heroBbox } : null;

  if (!heroCand) {
    await page.close();
    return { html: "<div style='padding:4rem;background:#1a1a2e;color:#fff;text-align:center'><h2>Hero section not found</h2></div>", isFallback: true };
  }

  // Take a screenshot crop of the hero area — cap at 900px to stay within LLM token limits
  const clip = {
    x: Math.max(0, heroCand.boundingBox.x),
    y: Math.max(0, heroCand.boundingBox.y),
    width: Math.min(1440, heroCand.boundingBox.width || 1440),
    height: Math.min(900, pageHeight - heroCand.boundingBox.y, heroCand.boundingBox.height),
  };
  const cropBuf = await page.screenshot({ fullPage: true, clip });
  const screenshotDataUri = `data:image/png;base64,${cropBuf.toString("base64")}`;

  // Extract hero DOM data BEFORE closing the page — background image, CTA color/position.
  // Uses getComputedStyle (same as extractSectionDomStyles in the real pipeline).
  const herodomData = await page.evaluate((heroY: number) => {
    // ── Background image: largest bg-image element on page ──
    let bgUrl: string | null = null;
    let bestArea = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const s = getComputedStyle(el as Element);
      if (!s.backgroundImage || s.backgroundImage === 'none') continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        const m = s.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (m?.[1]) { bestArea = area; bgUrl = m[1]; }
      }
    }

    // ── CTA: most-saturated button/link in hero area ──
    const rgbSat = (rgb: string) => {
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 0;
      const r = +(m[1]!)/255, g = +(m[2]!)/255, b = +(m[3]!)/255;
      const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l=(mx+mn)/2;
      return mx===mn ? 0 : (mx-mn)/(l>0.5 ? 2-mx-mn : mx+mn);
    };
    let ctaEl: Element | null = null, bestSat = 0.15;
    for (const el of Array.from(document.querySelectorAll('a, button'))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      const absTop = r.top + window.scrollY;
      if (absTop < heroY || absTop > heroY + 1200) continue; // in hero area
      if (r.width < 40 || r.height < 24) continue;
      const bg = getComputedStyle(el as Element).backgroundColor;
      const sat = rgbSat(bg);
      if (sat > bestSat) { bestSat = sat; ctaEl = el; }
    }

    // CTA position relative to page center (left/right/center)
    let ctaPositionSide: 'left'|'right'|'center' = 'center';
    if (ctaEl) {
      const cr = (ctaEl as HTMLElement).getBoundingClientRect();
      const pageW = document.documentElement.clientWidth;
      if (cr.left > pageW * 0.55) ctaPositionSide = 'right';
      else if (cr.right < pageW * 0.45) ctaPositionSide = 'left';
    }

    const ctaS = ctaEl ? getComputedStyle(ctaEl) : null;
    return {
      bgUrl,
      ctaBackground: ctaS?.backgroundColor ?? null,
      ctaColor: ctaS?.color ?? null,
      ctaBorderRadius: ctaS?.borderRadius ?? null,
      ctaLabel: ctaEl ? (ctaEl as HTMLElement).textContent?.trim() ?? '' : '',
      ctaHref: ctaEl ? (ctaEl as HTMLAnchorElement).getAttribute('href') ?? '#' : '#',
      ctaPositionSide,
    };
  }, clip.y);

  const heroBgImageUrl = herodomData.bgUrl;

  await page.close();

  // Build a minimal HierarchySection for the hero
  const heroSection: HierarchySection = {
    id: "test-hero",
    tag: "hero",
    intent: "hero",
    content: { heading: "", body: "", images: [] },
    evidenceId: "test-hero",
  };

  const evidence: SectionVisualEvidenceRow = {
    evidenceId: "test-hero",
    pageSlug: "index",
    sectionId: "test-hero",
    screenshotUrl: screenshotDataUri,
    boundingBox: heroCand.boundingBox,
    computedStyles: [],
  };

  const rules: ResponsiveRule[] = designSystem.responsive?.rules ?? [];
  const tailwindInstructions = breakpointDeltasToTailwind(rules);

  console.log(`  Background image: ${heroBgImageUrl ? heroBgImageUrl.slice(0, 70) : "not found"}`);
  console.log(`  CTA: "${herodomData.ctaLabel}" bg=${herodomData.ctaBackground} position=${herodomData.ctaPositionSide}`);

  if (heroBgImageUrl) heroSection.content.images = [{ url: heroBgImageUrl }];
  if (herodomData.ctaLabel) {
    heroSection.content.cta = { label: herodomData.ctaLabel, href: herodomData.ctaHref };
  }

  // Pass CTA DOM facts into evidence.domStyles so buildVisualPrompt adds them
  // to the "Exact computed values from live DOM" block — same path as real pipeline
  if (herodomData.ctaBackground || herodomData.ctaPositionSide) {
    evidence.domStyles = {
      ctaBackground: herodomData.ctaBackground ?? undefined,
      ctaColor: herodomData.ctaColor ?? undefined,
      ctaBorderRadius: herodomData.ctaBorderRadius ?? undefined,
      ctaPositionSide: herodomData.ctaPositionSide ?? undefined,
    };
  }

  console.log(`  Hero bbox: y=${clip.y}, h=${clip.height}, screenshotSize=${cropBuf.length} bytes`);
  console.log("  Calling LLM for hero section...");
  const result = await renderVisualBlockWithFlag({
    section: heroSection,
    evidence,
    designSystem,
    tailwindInstructions,
    config: noopConfig,
  });

  if (result.isFallback) {
    console.log("  ⚠ Fell back — screenshot may not have reached LLM or response was truncated");
  } else {
    console.log(`  ✓ LLM rendered (${result.code.length} chars)`);
  }
  return { html: result.code, isFallback: result.isFallback, sectionHeight: heroCand.boundingBox.height };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔧 Shell mini-pipeline: ${url}`);
  console.log("━".repeat(50));

  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  // ── Step 1: Extract ────────────────────────────────────────────────────
  console.log("\n[1/5] Extracting page (Playwright)...");
  const captured = await capturePage(ctx, url);
  const nav = await extractNavData(await ctx.newPage().then(async p => {
    await p.goto(url, { waitUntil: "networkidle" });
    await p.waitForTimeout(1000);
    return p;
  }));

  // ── Step 2: Build design system ────────────────────────────────────────
  console.log("[2/5] Building design system...");
  // Build a minimal valid ExtractArtifact from the captured page data
  const extractArtifact: ExtractArtifact = {
    url,
    extractedAt: new Date().toISOString(),
    css: {
      tokens: {},
      breakpoints: captured.responsive.map(r => r.selector).filter(Boolean),
      animations: [],
      webFontUrls: captured.media
        .filter(m => m.resourceType === "stylesheet" &&
          ["fonts.googleapis.com", "font-awesome", "typekit"].some(p => m.url.includes(p)))
        .map(m => m.url),
    },
    pages: [{
      path: "/",
      media: captured.media,
      screenshots: {
        full1440: captured.screenshots.full1440.toString("base64"),
        vp375: captured.screenshots.vp375.toString("base64"),
        vp768: captured.screenshots.vp768.toString("base64"),
      },
      content: { ...captured.content, rawText: "" } as any,
      interactions: [],
      responsive: captured.responsive,
      pixelSamples: captured.pixelSamples,
      computedTheme: captured.computedTheme,
      flags: captured.flags,
    }],
    siteMap: [],
    sourceBaseline: {
      capturedAt: new Date().toISOString(),
      lighthouse: [],
      axe: [],
      network: [{ path: "/", totalBytes: captured.networkStats.totalBytes, requestCount: captured.networkStats.requestCount, imageBytes: captured.networkStats.imageBytes }],
    },
    usage: { pagesCaptured: 1, screenshotCount: 3 },
    extractedNav: nav ?? undefined,
  };
  const designSystem = buildDesignSystemFromExtract(extractArtifact);

  // ── Step 3: Render nav ─────────────────────────────────────────────────
  console.log("[3/5] Rendering nav (deterministic)...");
  /** Strip Astro frontmatter + template expressions so it renders in a browser */
  const toHtml = (astro: string) => astro
    .replace(/^---[\s\S]*?---\n?/m, "")  // strip frontmatter
    .trim();

  const navAstroSource = nav ? renderNavComponent(nav) : "<nav>No nav found</nav>";
  const navHtml = toHtml(navAstroSource);

  // ── Step 4: Render hero (LLM) ──────────────────────────────────────────
  console.log("[4/5] Rendering hero (LLM + screenshot)...");
  const { html: heroHtmlRaw, isFallback: heroFallback, sectionHeight: heroSectionHeight } = await renderHeroSection(ctx, url, designSystem);
  // Strip frontmatter from rendered Astro; if fallback show placeholder
  const heroHtml = heroFallback
    ? `<div style="background:#1a1a2e;min-height:500px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.4);font-size:1rem;">Hero section — LLM render pending</div>`
    : toHtml(heroHtmlRaw)
        // Inject actual DOM-measured height as a CSS variable so Tailwind arbitrary
        // values that the CDN can't process fall back to the real section height.
        .replace(/(<section[^>]*data-section-id[^>]*>)/, `$1\n<style>[data-section-id="test-hero"]{min-height:${heroSectionHeight}px}</style>`);
  if (heroFallback) console.log("  ⚠ Hero fell back to placeholder");

  // ── Step 5: Render footer ──────────────────────────────────────────────
  console.log("[5/5] Rendering footer (deterministic)...");
  const footerData = await extractFooterData(ctx, url);
  const footerHtml = toHtml(renderFooterComponent(footerData));

  await browser.close();

  // ── Page switcher from nav links ───────────────────────────────────────
  const allNavLinks: { label: string; href: string }[] = [];
  const collectLinks = (links: ExtractedNav["links"]) => {
    for (const l of links) {
      if (l.href && l.href !== "#" && l.href.startsWith("/")) allNavLinks.push({ label: l.label, href: l.href });
      if (l.children) collectLinks(l.children);
    }
  };
  if (nav) collectLinks(nav.links);
  const uniquePages = [{ label: "Home", href: "/" }, ...new Map(allNavLinks.map(p => [p.href, p])).values()];
  const origin = new URL(url).origin;
  const pageOptions = uniquePages.map(p =>
    `<option value="${origin}${p.href}">${p.label} — ${p.href}</option>`
  ).join("\n");

  // ── Write HTML ─────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shell Preview — ${url}</title>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; font-family: sans-serif; }
    .switcher { background: #0f172a; color: #94a3b8; padding: 0.5rem 1rem; display: flex; align-items: center; gap: 1rem; font-size: 0.8rem; position: sticky; top: 0; z-index: 200; }
    .switcher select { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 0.25rem 0.5rem; }
    .switcher label { color: #64748b; }
    .page-gap { padding: 4rem 2rem; text-align: center; background: #f8fafc; color: #94a3b8; border-top: 1px dashed #e2e8f0; border-bottom: 1px dashed #e2e8f0; }
    .page-gap strong { color: #64748b; display: block; margin-bottom: 0.5rem; }
  </style>
</head>
<body>

<div class="switcher">
  <span>🔧 Shell Preview</span>
  <label>Switch page:</label>
  <select id="pageswitcher">
    ${pageOptions}
  </select>
  <span style="margin-left:auto;opacity:0.5">${url}</span>
</div>

${navHtml}

<!-- HERO — rendered by same LLM + renderVisualBlockWithFlag() as real build -->
${heroHtml}

<!-- PAGE CONTENT PLACEHOLDER -->
<div class="page-gap">
  <strong>Page content sections</strong>
  Rendered sections would appear here in the full build
</div>

<!-- FOOTER — rendered by renderFooterComponent() same as real build -->
${footerHtml}

<script>
document.getElementById('pageswitcher').addEventListener('change', function() {
  const newUrl = this.value;
  // Re-run the script with this URL (user would do this manually or via API)
  console.log('Switch to:', newUrl);
  window.open(newUrl, '_blank');
});
</script>
</body>
</html>`;

  await writeFile(out, html);

  console.log(`\n✓ Done → ${out}`);
  console.log(`  open ${out}`);
  console.log(`\nPipeline:`);
  console.log(`  Nav:   ${nav ? `${nav.links.length} links, ${nav.links.filter(l=>l.children?.length).length} dropdowns` : "not found"}`);
  console.log(`  Hero:  ${heroFallback ? "⚠ fallback" : "✓ LLM rendered"}`);
  console.log(`  Footer: ${footerData.links.length} links`);
  console.log(`  Primary color: ${designSystem.global.tokens.colors.primary}`);
  console.log(`  Font: ${designSystem.global.tokens.fonts.heading}`);
}

main().catch(err => { console.error(err); process.exit(1); });
