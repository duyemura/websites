/**
 * Quick nav extraction + render test.
 * Usage (from apps/api):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/test-nav.ts <url>
 *
 * Scrapes the URL, extracts nav data via Playwright, renders it to /tmp/test-nav.html
 * so you can open it in a browser and see the result immediately.
 */
import "dotenv/config";
import { chromium } from "playwright";
import { writeFile } from "fs/promises";
import { extractNavData } from "../src/utils/pipeline/capture-page";
import { renderNavComponent } from "../src/services/astro-code-generator";
import type { ExtractedNav } from "../src/types/pipeline-artifacts";

const url = process.argv[2] ?? "https://www.torrancetraininglab.com/";
const out = process.argv[3] ?? "/tmp/test-nav.html";

// tsx's esbuild wraps arrow functions with __name() which isn't available in
// the browser context. Patch chromium.launch to inject it as a no-op.
const origLaunch = chromium.launch.bind(chromium);
chromium.launch = async (...args: Parameters<typeof chromium.launch>) => {
  const browser = await origLaunch(...args);
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...ctxArgs: Parameters<typeof browser.newContext>) => {
    const ctx = await origNewContext(...ctxArgs);
    await ctx.addInitScript(() => { (globalThis as any).__name ??= (fn: unknown) => fn; });
    return ctx;
  };
  return browser;
};

async function main() {
  console.log(`Scraping nav from: ${url}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1500);

  const nav = await extractNavData(page);
  await browser.close();

  if (!nav) {
    console.error("No nav found on this page.");
    process.exit(1);
  }

  console.log("\n=== Extracted nav data ===");
  console.log(JSON.stringify(nav, null, 2));

  // renderNavComponent returns Astro source — extract just the HTML template part
  const astroSource = renderNavComponent(nav);
  // Strip frontmatter (--- ... ---) to get the HTML template
  const htmlPart = astroSource.replace(/^---[\s\S]*?---\n?/m, "").trim();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nav Test — ${url}</title>
  <!-- Alpine.js for interactivity -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  <!-- Tailwind CDN for rapid preview -->
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* preview: mock page body below the nav */
    body { margin: 0; font-family: sans-serif; background: #f5f5f5; }
    .page-preview {
      padding: 3rem 2rem;
      text-align: center;
      color: #888;
    }
  </style>
</head>
<body>
  <!-- EXTRACTED NAV -->
  ${htmlPart}

  <!-- MOCK PAGE BODY -->
  <div class="page-preview">
    <h1 style="font-size:2rem;color:#333">Page content would go here</h1>
    <p>This is a nav-only preview. Resize the window to test mobile behavior.</p>
  </div>

  <!-- RAW DATA PANEL -->
  <details style="margin:2rem;padding:1rem;background:#fff;border:1px solid #ddd;border-radius:8px">
    <summary style="cursor:pointer;font-weight:bold;margin-bottom:0.5rem">Raw extracted nav data</summary>
    <pre style="font-size:0.75rem;overflow:auto;max-height:400px">${JSON.stringify(nav, null, 2)}</pre>
  </details>
</body>
</html>`;

  await writeFile(out, html);
  console.log(`\n✓ Written to ${out}`);
  console.log(`  Open in browser: open ${out}`);
  console.log(`\nNav summary:`);
  console.log(`  Logo: ${nav.logo.type} — ${nav.logo.value.slice(0, 60)}`);
  console.log(`  Links: ${nav.links.length} (${nav.links.filter(l => l.children?.length).length} with dropdowns)`);
  console.log(`  CTA: ${nav.cta ? nav.cta.label : "none"}`);
  console.log(`  Position: ${nav.position}`);
  console.log(`  Mobile toggle: ${nav.hasMobileToggle}`);
  console.log(`  Background: ${nav.background}`);
}

main().catch(err => { console.error(err); process.exit(1); });
