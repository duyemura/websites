/**
 * Site shell mini-pipeline — builds nav + hero + footer using the EXACT
 * same functions as the real build pipeline, then runs astro build to
 * produce compiled output you can open in a browser.
 *
 * Usage (from apps/api):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/test-shell.ts <url>
 *
 * Output: opens /tmp/test-shell-dist/index.html in the browser.
 * ~60s on first run (pnpm install), ~30s after (cached node_modules).
 */
import "dotenv/config";
import { chromium, type BrowserContext } from "playwright";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";

// ── Same functions as the real build pipeline ──────────────────────────────
import { capturePage, extractNavData } from "../src/utils/pipeline/capture-page";
import {
  renderNavComponent,
  renderFooterComponent,
  writeProjectScaffold,
  relativizeAssetPaths,
  inlineCssIntoHtml,
} from "../src/services/astro-code-generator";
import { buildDesignSystemFromExtract } from "../src/utils/design-system-builder";
import { renderVisualBlockWithFlag } from "../src/services/visual-section-renderer";
import { breakpointDeltasToTailwind } from "../src/utils/pipeline/breakpoint-tailwind";
import type { ExtractArtifact, ResponsiveRule } from "../src/types/pipeline-artifacts";
import type { DesignSystemV2 } from "../src/types/design-system-v2";
import type { HierarchySection } from "../src/types/site-hierarchy";
import type { SectionVisualEvidenceRow } from "../src/types/section-visual-evidence";

// ── Config stub matching real pipeline ────────────────────────────────────
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
} as any;

// ── Args ──────────────────────────────────────────────────────────────────
const rawUrl = process.argv[2] ?? "https://www.torrancetraininglab.com/";
const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
const sourceDir = path.join(os.tmpdir(), "test-shell-build");
const distDir = path.join(sourceDir, "dist");

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

// ── Subprocess runner (same as build-stage) ───────────────────────────────
function runProcess(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    child.on("error", reject);
  });
}

// ── Footer extraction ─────────────────────────────────────────────────────
async function extractFooterData(ctx: BrowserContext, pageUrl: string) {
  const page = await ctx.newPage();
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => {
    const getText = (el: Element | null) => el?.textContent?.trim() ?? "";
    const footer = document.querySelector("footer, [role='contentinfo'], [class*='footer']") as HTMLElement | null;
    if (!footer) return { background: "#1a1a1a", textColor: "#fff", brandName: "", logoUrl: undefined as string|undefined, links: [] as {label:string;href:string}[], copyright: "" };
    const s = getComputedStyle(footer);
    const imgEl = footer.querySelector("img") as HTMLImageElement | null;
    const links = Array.from(footer.querySelectorAll("a[href]"))
      .filter(a => { const h = (a as HTMLAnchorElement).getAttribute("href") ?? ""; return h && !h.startsWith("mailto:") && !h.startsWith("tel:"); })
      .map(a => ({ label: getText(a), href: (a as HTMLAnchorElement).getAttribute("href") ?? "" }))
      .filter(l => l.label).slice(0, 16);
    const copyright = footer.textContent?.match(/©[^<\n]{0,100}/)?.[0]?.trim() ?? "";
    return { background: s.backgroundColor || "#1a1a1a", textColor: s.color || "#fff",
      brandName: imgEl?.alt || "", logoUrl: imgEl?.src || undefined, links, copyright };
  });
  await page.close();
  return data;
}

// ── Hero extraction + render ──────────────────────────────────────────────
async function renderHero(ctx: BrowserContext, pageUrl: string, designSystem: DesignSystemV2): Promise<string> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  // Find hero bounding box — prefer bg-image elements
  const heroBbox = await page.evaluate(() => {
    const navEl = document.querySelector('[role="banner"], header');
    const navBottom = navEl ? navEl.getBoundingClientRect().bottom + window.scrollY : 80;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      const absTop = r.top + window.scrollY;
      if (absTop < navBottom - 5 || r.height < 200 || r.width < 800) continue;
      const s = getComputedStyle(el as Element);
      if (s.backgroundImage && s.backgroundImage !== 'none')
        return { x: 0, y: Math.round(absTop), width: 1440, height: Math.round(r.height) };
    }
    for (const el of Array.from(document.querySelectorAll('section,[class*="hero"],main>div'))) {
      const r = el.getBoundingClientRect();
      const absTop = r.top + window.scrollY;
      if (absTop >= navBottom && r.height > 300 && r.width > 800)
        return { x: 0, y: Math.round(absTop), width: 1440, height: Math.round(r.height) };
    }
    return null;
  });

  if (!heroBbox) { await page.close(); return ""; }

  const clip = { x: 0, y: heroBbox.y, width: 1440, height: Math.min(900, pageHeight - heroBbox.y, heroBbox.height) };
  const cropBuf = await page.screenshot({ fullPage: true, clip });
  const screenshotDataUri = `data:image/png;base64,${cropBuf.toString("base64")}`;

  // Extract hero DOM data while page is still open
  const heroData = await page.evaluate((heroY: number) => {
    // Background image (largest)
    let bgUrl: string | null = null, bestArea = 0;
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
    // CTA: most saturated button in hero area
    const sat = (rgb: string) => {
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 0;
      const r=+(m[1]!)/255,g=+(m[2]!)/255,b=+(m[3]!)/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;
      return mx===mn?0:(mx-mn)/(l>0.5?2-mx-mn:mx+mn);
    };
    let ctaEl:Element|null=null, bestSat=0.15;
    for (const el of Array.from(document.querySelectorAll('a, button'))) {
      const r=(el as HTMLElement).getBoundingClientRect();
      if (r.top+window.scrollY<heroY||r.top+window.scrollY>heroY+1200) continue;
      if (r.width<40||r.height<24) continue;
      const s=sat(getComputedStyle(el as Element).backgroundColor);
      if (s>bestSat){bestSat=s;ctaEl=el;}
    }
    const ctaS=ctaEl?getComputedStyle(ctaEl):null;
    const pw=document.documentElement.clientWidth;
    let ctaPos:'left'|'right'|'center'='center';
    if (ctaEl){const cr=(ctaEl as HTMLElement).getBoundingClientRect();if(cr.left>pw*0.55)ctaPos='right';else if(cr.right<pw*0.45)ctaPos='left';}
    return { bgUrl, ctaBg:ctaS?.backgroundColor??null, ctaColor:ctaS?.color??null, ctaRadius:ctaS?.borderRadius??null,
      ctaLabel:ctaEl?(ctaEl as HTMLElement).textContent?.trim()??'':'', ctaHref:ctaEl?(ctaEl as HTMLAnchorElement).getAttribute('href')??'#':'#', ctaPos };
  }, heroBbox.y);

  await page.close();

  console.log(`  BG image: ${heroData.bgUrl ? heroData.bgUrl.slice(0,70) : "not found"}`);
  console.log(`  CTA: "${heroData.ctaLabel}" bg=${heroData.ctaBg} pos=${heroData.ctaPos}`);

  const heroSection: HierarchySection = {
    id: "test-hero", tag: "hero", intent: "hero",
    content: {
      heading: "", body: "",
      images: heroData.bgUrl ? [{ url: heroData.bgUrl }] : [],
      cta: heroData.ctaLabel ? { label: heroData.ctaLabel, href: heroData.ctaHref } : undefined,
    },
    evidenceId: "test-hero",
  };

  const evidence: SectionVisualEvidenceRow = {
    evidenceId: "test-hero", pageSlug: "index", sectionId: "test-hero",
    screenshotUrl: screenshotDataUri, boundingBox: heroBbox, computedStyles: [],
    domStyles: {
      ctaBackground: heroData.ctaBg ?? undefined, ctaColor: heroData.ctaColor ?? undefined,
      ctaBorderRadius: heroData.ctaRadius ?? undefined, ctaPositionSide: heroData.ctaPos,
    },
  };

  const rules: ResponsiveRule[] = designSystem.responsive?.rules ?? [];
  const result = await renderVisualBlockWithFlag({
    section: heroSection, evidence, designSystem,
    tailwindInstructions: breakpointDeltasToTailwind(rules), config: noopConfig,
  });

  console.log(`  Hero: ${result.isFallback ? "⚠ fallback" : `✓ LLM rendered (${result.code.length} chars)`}`);
  return result.code;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔧 Shell mini-pipeline: ${url}`);
  console.log("━".repeat(50));

  const browser = await chromium.launch();
  const ctx = await browser.newContext();

  // ── Step 1: Extract ────────────────────────────────────────────────────
  console.log("\n[1/6] Extracting page (Playwright)...");
  const captured = await capturePage(ctx, url);
  const navPage = await ctx.newPage();
  await navPage.goto(url, { waitUntil: "networkidle" });
  await navPage.waitForTimeout(1000);
  const nav = await extractNavData(navPage);
  await navPage.close();

  // ── Step 2: Build design system ────────────────────────────────────────
  console.log("[2/6] Building design system...");
  const extract: ExtractArtifact = {
    url, extractedAt: new Date().toISOString(),
    css: { tokens: {}, breakpoints: [], animations: [], webFontUrls: captured.media
      .filter(m => m.resourceType === "stylesheet" && ["fonts.googleapis.com","font-awesome","typekit"].some(p=>m.url.includes(p)))
      .map(m => m.url) },
    pages: [{ path: "/", media: captured.media,
      screenshots: { full1440: captured.screenshots.full1440.toString("base64"), vp375: captured.screenshots.vp375.toString("base64"), vp768: captured.screenshots.vp768.toString("base64") },
      content: { ...captured.content, rawText: "" } as any,
      interactions: [], responsive: captured.responsive, pixelSamples: captured.pixelSamples,
      computedTheme: captured.computedTheme, flags: captured.flags }],
    siteMap: [], extractedNav: nav ?? undefined,
    sourceBaseline: { capturedAt: new Date().toISOString(), lighthouse: [], axe: [],
      network: [{ path: "/", totalBytes: captured.networkStats.totalBytes, requestCount: captured.networkStats.requestCount, imageBytes: captured.networkStats.imageBytes }] },
    usage: { pagesCaptured: 1, screenshotCount: 3 },
  };
  const designSystem = buildDesignSystemFromExtract(extract);

  // ── Step 3: Render shell sections ──────────────────────────────────────
  console.log("[3/6] Rendering nav (deterministic)...");
  const navSource = nav ? renderNavComponent(nav) : "---\n---\n<nav>No nav found</nav>";

  console.log("[4/6] Rendering hero (LLM + screenshot)...");
  const heroSource = await renderHero(ctx, url, designSystem);

  console.log("[5/6] Rendering footer (deterministic)...");
  const footerData = await extractFooterData(ctx, url);
  const footerSource = renderFooterComponent(footerData);

  await browser.close();

  // ── Step 6: Build real Astro project ───────────────────────────────────
  console.log("[6/6] Building Astro project...");
  await rm(sourceDir, { recursive: true, force: true });
  await writeProjectScaffold(sourceDir, designSystem, { webFontUrls: extract.css.webFontUrls });

  // Write shell components
  const sectionsDir = path.join(sourceDir, "src", "components", "sections");
  await mkdir(sectionsDir, { recursive: true });
  await writeFile(path.join(sourceDir, "src", "components", "shared", "Header.astro"), navSource);
  await writeFile(path.join(sourceDir, "src", "components", "shared", "Footer.astro"), footerSource);

  // Write a single index page: nav (via layout) + hero + placeholder + footer (via layout)
  const heroComponentPath = path.join(sectionsDir, "shell-hero.astro");
  await writeFile(heroComponentPath, heroSource || `---\n---\n<div style="min-height:500px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.4)">Hero section</div>`);

  const indexPage = `---
import Layout from "../layouts/Layout.astro";
import Hero from "../components/sections/shell-hero.astro";
---
<Layout title="${new URL(url).hostname}">
  <Hero />
  <div style="padding:3rem 2rem;text-align:center;background:#f8fafc;color:#94a3b8;border-top:1px dashed #e2e8f0">
    <strong style="display:block;color:#64748b;margin-bottom:0.5rem">Page content sections</strong>
    Full build renders all sections here
  </div>
</Layout>
`;
  await writeFile(path.join(sourceDir, "src", "pages", "index.astro"), indexPage);

  // pnpm install + astro build
  await runProcess("pnpm", ["install"], sourceDir);
  await runProcess("pnpm", ["exec", "astro", "build"], sourceDir);
  await relativizeAssetPaths(distDir);
  await inlineCssIntoHtml(distDir);

  const outFile = path.join(distDir, "index.html");
  console.log(`\n✓ Built → ${outFile}`);
  console.log(`  open ${outFile}`);
  console.log(`\nPipeline:`);
  console.log(`  Nav:    ${nav ? `${nav.links.length} links, ${nav.links.filter(l=>l.children?.length).length} dropdowns` : "not found"}`);
  console.log(`  Footer: ${footerData.links.length} links`);
  console.log(`  Primary: ${designSystem.global.tokens.colors.primary}`);
  console.log(`  Font:    ${designSystem.global.tokens.fonts.heading}`);

  // Open in browser
  const { exec } = await import("child_process");
  exec(`open ${outFile}`);
}

main().catch(err => { console.error(err); process.exit(1); });
