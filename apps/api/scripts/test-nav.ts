/**
 * Site shell preview — nav + hero + footer with page switcher.
 * Usage (from apps/api):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/test-nav.ts <url> [output.html]
 *
 * Scrapes the URL, extracts nav/hero/footer via Playwright, renders a full
 * shell preview to /tmp/test-nav.html so you can inspect the site structure.
 * Includes a page switcher for all nav-linked URLs.
 */
import "dotenv/config";
import { chromium, type Page } from "playwright";
import { writeFile } from "fs/promises";
import { extractNavData } from "../src/utils/pipeline/capture-page";
import { renderNavComponent } from "../src/services/astro-code-generator";
import type { ExtractedNav } from "../src/types/pipeline-artifacts";

// Normalize URL — add https:// if no protocol given
const rawUrl = process.argv[2] ?? "https://www.torrancetraininglab.com/";
const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
const out = process.argv[3] ?? "/tmp/test-nav.html";

// ── __name patch for tsx/esbuild ──────────────────────────────────────────
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

// ── Hero extraction ───────────────────────────────────────────────────────
interface ExtractedHero {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  ctaBackground: string;
  backgroundImageUrl: string;
  overlayColor: string;
  eyebrow: string;
}

async function extractHero(page: Page): Promise<ExtractedHero> {
  return page.evaluate((): ExtractedHero => {
    const getText = (el: Element | null) => el?.textContent?.trim() ?? "";

    // Find the hero: first large section below the nav
    const candidates = Array.from(document.querySelectorAll(
      "section, [class*='hero'], [class*='banner'], main > div, body > div"
    ));
    const navBanner = document.querySelector('[role="banner"], header');
    const navBottom = navBanner ? navBanner.getBoundingClientRect().bottom + window.scrollY : 80;

    const heroEl = candidates.find(el => {
      const r = el.getBoundingClientRect();
      const absTop = r.top + window.scrollY;
      return absTop >= navBottom - 10 && r.height > 200 && r.width > 500;
    }) ?? candidates[0] ?? document.body;

    const s = getComputedStyle(heroEl as Element);

    // Background image
    let bgImage = s.backgroundImage;
    if (!bgImage || bgImage === "none") {
      const bgEl = heroEl.querySelector('[style*="background-image"], [class*="bg-image"], [class*="background-image"]') as HTMLElement | null;
      bgImage = bgEl ? getComputedStyle(bgEl).backgroundImage : "none";
    }
    const bgImageUrl = bgImage !== "none" ? bgImage.replace(/url\(["']?([^"')]+)["']?\).*/, "$1") : "";

    // Overlay
    let overlayColor = "rgba(0,0,0,0.4)";
    for (const child of Array.from(heroEl.querySelectorAll("*"))) {
      const cs = getComputedStyle(child as Element);
      if ((cs.position === "absolute" || cs.position === "fixed") && cs.backgroundColor.startsWith("rgba(0")) {
        overlayColor = cs.backgroundColor;
        break;
      }
    }

    // Content
    const heading = getText(heroEl.querySelector("h1, h2")) || "Welcome";
    const body = getText(heroEl.querySelector("p")) || "";
    const eyebrow = getText(heroEl.querySelector("[class*='eyebrow'],[class*='badge'],[class*='label']:not(label)")) || "";

    // CTA button — most saturated bg
    const rgbSat = (rgb: string) => {
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 0;
      const r = +m[1]!/255, g = +m[2]!/255, b = +m[3]!/255;
      const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2;
      return mx===mn ? 0 : (mx-mn)/(l>0.5 ? 2-mx-mn : mx+mn);
    };
    let ctaEl: Element | null = null, bestSat = 0.1;
    for (const el of Array.from(heroEl.querySelectorAll("a, button"))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 40 || r.height < 24) continue;
      const bg = getComputedStyle(el as Element).backgroundColor;
      const sat = rgbSat(bg);
      if (sat > bestSat) { bestSat = sat; ctaEl = el; }
    }
    const ctaS = ctaEl ? getComputedStyle(ctaEl) : null;

    return {
      heading,
      body,
      eyebrow,
      ctaLabel: getText(ctaEl) || "Get Started",
      ctaHref: (ctaEl as HTMLAnchorElement)?.getAttribute("href") || "#",
      ctaBackground: ctaS?.backgroundColor || "rgb(0,99,255)",
      backgroundImageUrl: bgImageUrl,
      overlayColor,
    };
  });
}

// ── Footer extraction ─────────────────────────────────────────────────────
interface ExtractedFooter {
  background: string;
  textColor: string;
  brandName: string;
  links: { label: string; href: string }[];
  copyright: string;
}

async function extractFooter(page: Page): Promise<ExtractedFooter> {
  return page.evaluate((): ExtractedFooter => {
    const getText = (el: Element | null) => el?.textContent?.trim() ?? "";
    const footerEl = document.querySelector("footer, [role='contentinfo'], [class*='footer']") as HTMLElement | null;
    if (!footerEl) return { background: "#1a1a1a", textColor: "#fff", brandName: "", links: [], copyright: "" };

    const s = getComputedStyle(footerEl);
    const links = Array.from(footerEl.querySelectorAll("a[href]"))
      .filter(a => {
        const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
        return href && !href.startsWith("mailto:") && !href.startsWith("tel:");
      })
      .map(a => ({ label: getText(a), href: (a as HTMLAnchorElement).getAttribute("href") ?? "" }))
      .filter(l => l.label.length > 0)
      .slice(0, 12);

    const copyright = getText(footerEl.querySelector("[class*='copyright'], [class*='copy']")) ||
      footerEl.textContent?.match(/©[^<\n]{0,80}/)?.[ 0] || "";

    const brandEl = footerEl.querySelector("img, [class*='logo'], [class*='brand']");
    const brandName = brandEl instanceof HTMLImageElement ? (brandEl.alt || "") : getText(brandEl);

    return {
      background: s.backgroundColor || "#1a1a1a",
      textColor: s.color || "#fff",
      brandName,
      links,
      copyright,
    };
  });
}

// ── Renderers ────────────────────────────────────────────────────────────
function renderHero(hero: ExtractedHero, siteUrl: string): string {
  const bgStyle = hero.backgroundImageUrl
    ? `background-image: url('${hero.backgroundImageUrl}'); background-size: cover; background-position: center;`
    : "background: #1a1a2e;";
  const ctaBg = hero.ctaBackground;
  const ctaHref = hero.ctaHref.startsWith("/") ? `${siteUrl}${hero.ctaHref}` : hero.ctaHref;

  return `
<section style="${bgStyle} position: relative; min-height: 580px; display: flex; align-items: flex-end;">
  <div style="position:absolute;inset:0;background:${hero.overlayColor};"></div>
  <div style="position:relative;z-index:10;padding:3rem 2.5rem;max-width:700px;">
    ${hero.eyebrow ? `<p style="display:inline-block;background:rgba(255,255,255,0.15);color:#fff;font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:0.25rem 0.75rem;border-radius:999px;margin-bottom:1rem;">${hero.eyebrow}</p>` : ""}
    <h1 style="color:#fff;font-size:clamp(2rem,5vw,3.5rem);font-weight:900;line-height:1.1;margin:0 0 1rem;">${hero.heading}</h1>
    ${hero.body ? `<p style="color:rgba(255,255,255,0.85);font-size:1.1rem;margin:0 0 1.75rem;max-width:500px;">${hero.body}</p>` : ""}
    <a href="${ctaHref}" style="display:inline-flex;align-items:center;gap:0.5rem;background:${ctaBg};color:#fff;padding:1rem 2rem;border-radius:8px;font-weight:700;text-decoration:none;font-size:1rem;">
      ▶ ${hero.ctaLabel}
    </a>
  </div>
</section>`;
}

function renderFooter(footer: ExtractedFooter): string {
  const links = footer.links.map(l =>
    `<a href="${l.href}" style="color:rgba(255,255,255,0.7);text-decoration:none;font-size:0.9rem;">${l.label}</a>`
  ).join("\n    ");

  return `
<footer style="background:${footer.background};color:${footer.textColor};padding:3rem 2rem;">
  <div style="max-width:1200px;margin:0 auto;">
    ${footer.brandName ? `<div style="font-size:1.25rem;font-weight:700;margin-bottom:1.5rem;opacity:0.9;">${footer.brandName}</div>` : ""}
    <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:2rem;">
      ${links}
    </div>
    ${footer.copyright ? `<div style="font-size:0.8rem;opacity:0.5;border-top:1px solid rgba(255,255,255,0.1);padding-top:1.5rem;">${footer.copyright}</div>` : ""}
  </div>
</footer>`;
}

function collectAllLinks(links: ExtractedNav["links"]): { label: string; href: string }[] {
  const result: { label: string; href: string }[] = [];
  for (const l of links) {
    if (l.href && l.href !== "#") result.push({ label: l.label, href: l.href });
    if (l.children) result.push(...collectAllLinks(l.children));
  }
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const baseUrl = new URL(url).origin;
  console.log(`Scraping shell from: ${url}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1500);

  const [nav, hero, footer] = await Promise.all([
    extractNavData(page),
    extractHero(page),
    extractFooter(page),
  ]);

  await browser.close();

  if (!nav) { console.error("No nav found."); process.exit(1); }

  // Build page switcher options from all nav links
  const allLinks = collectAllLinks(nav.links);
  const pageOptions = [
    { label: "Home", href: "/" },
    ...allLinks.filter(l => l.href.startsWith("/")),
  ];
  const uniquePages = [...new Map(pageOptions.map(p => [p.href, p])).values()];

  const navAstro = renderNavComponent(nav);
  const navHtml = navAstro.replace(/^---[\s\S]*?---\n?/m, "").trim();
  const heroHtml = renderHero(hero, baseUrl);
  const footerHtml = renderFooter(footer);

  const pageSwitcherOptions = uniquePages.map(p =>
    `<option value="${baseUrl}${p.href}"${url === baseUrl + p.href ? " selected" : ""}>${p.label} — ${p.href}</option>`
  ).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shell Preview — ${url}</title>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; font-family: sans-serif; background: #f5f5f5; }
    .switcher-bar { background: #1e293b; color: #fff; padding: 0.6rem 1.5rem; display: flex; align-items: center; gap: 1rem; font-size: 0.85rem; position: sticky; top: 0; z-index: 100; }
    .switcher-bar select { background: #334155; color: #fff; border: 1px solid #475569; border-radius: 6px; padding: 0.3rem 0.6rem; font-size: 0.85rem; }
    .switcher-bar span { opacity: 0.5; }
    .page-body { padding: 3rem 2rem; max-width: 900px; margin: 0 auto; color: #666; text-align: center; }
    .page-body h2 { color: #333; }
    details { margin: 2rem; padding: 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
    summary { cursor: pointer; font-weight: 600; }
    pre { font-size: 0.75rem; overflow: auto; max-height: 300px; }
  </style>
</head>
<body>

<!-- Page switcher bar -->
<div class="switcher-bar">
  <span>🔍 Shell Preview</span>
  <select onchange="window.location.href=this.value.startsWith('http') ? '?url='+this.value : window.location.href">
    ${pageSwitcherOptions}
  </select>
  <span>${url}</span>
</div>

<!-- NAV -->
${navHtml}

<!-- HERO -->
${heroHtml}

<!-- PAGE BODY PLACEHOLDER -->
<div class="page-body">
  <h2>Page content</h2>
  <p>This is a shell preview — nav, hero, and footer extracted from the live site.<br>
  Use the dropdown above to switch pages. Select a page to rebuild the shell for that URL.</p>
  <p style="margin-top:1rem">
    <a href="${url}" target="_blank" style="color:#3b82f6">View original →</a>
  </p>
</div>

<!-- FOOTER -->
${footerHtml}

<!-- Debug panels -->
<details>
  <summary>Nav data</summary>
  <pre>${JSON.stringify(nav, null, 2)}</pre>
</details>
<details>
  <summary>Hero data</summary>
  <pre>${JSON.stringify(hero, null, 2)}</pre>
</details>
<details>
  <summary>Footer data</summary>
  <pre>${JSON.stringify(footer, null, 2)}</pre>
</details>

<script>
  // Page switcher: re-run script with new URL
  document.querySelector('.switcher-bar select').addEventListener('change', function() {
    const newUrl = this.value;
    window.location.search = '?url=' + encodeURIComponent(newUrl);
  });
  // Read ?url= param and use it
  const params = new URLSearchParams(window.location.search);
  const targetUrl = params.get('url');
  if (targetUrl) {
    document.querySelector('.switcher-bar span:last-child').textContent = targetUrl;
  }
</script>
</body>
</html>`;

  await writeFile(out, html);
  console.log(`\n✓ Written to ${out}`);
  console.log(`  Open: open ${out}`);
  console.log(`\nSummary:`);
  console.log(`  Logo: ${nav.logo.type} — ${nav.logo.value.slice(0, 60)}`);
  console.log(`  Nav links: ${nav.links.length} (${nav.links.filter(l => l.children?.length).length} with dropdowns)`);
  console.log(`  Hero: "${hero.heading.slice(0, 50)}"`);
  console.log(`  Footer links: ${footer.links.length}`);
  console.log(`  Pages in switcher: ${uniquePages.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
