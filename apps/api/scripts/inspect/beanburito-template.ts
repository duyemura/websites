import { chromium, type Browser, type Page, type Locator } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const URL = "https://beanburito.github.io/free-intro-session-self-book-in-person/";
const OUT = path.resolve(import.meta.dirname, "./output/beanburito");

async function ensureDir() {
  await mkdir(OUT, { recursive: true });
}

async function captureFull(page: Page, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}x${height}.png`), fullPage: true });
}

async function captureElement(loc: Locator, name: string) {
  try {
    if (await loc.isVisible().catch(() => false)) {
      await loc.screenshot({ path: path.join(OUT, `${name}.png`) });
    }
  } catch {
    // ignore
  }
}

async function getComputedStyles(page: Page, selector: string, props: string[]) {
  return page.$$eval(selector, (els, keys) => {
    return els.slice(0, 3).map((el) => {
      const s = window.getComputedStyle(el);
      const out: Record<string, string> = {};
      keys.forEach((k) => (out[k] = s.getPropertyValue(k)));
      out["text"] = (el as HTMLElement).innerText?.slice(0, 80) ?? "";
      out["class"] = el.className;
      out["tag"] = el.tagName.toLowerCase();
      return out;
    });
  }, props);
}

async function getSectionTree(page: Page) {
  return page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("body > *"));
    return sections.map((s) => ({
      tag: s.tagName.toLowerCase(),
      className: s.className,
      id: s.id,
      text: (s as HTMLElement).innerText?.slice(0, 200).replace(/\s+/g, " ") ?? "",
      children: Array.from(s.querySelectorAll("section, div[class], article")).slice(0, 8).map((c) => ({
        tag: c.tagName.toLowerCase(),
        className: c.className,
        text: (c as HTMLElement).innerText?.slice(0, 120).replace(/\s+/g, " ") ?? "",
      })),
    }));
  });
}

async function getAssets(page: Page) {
  return page.evaluate(() => {
    const images = Array.from(document.querySelectorAll("img")).map((img) => ({
      src: img.currentSrc || img.src,
      alt: img.alt,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      href: (a as HTMLAnchorElement).href,
      text: (a as HTMLElement).innerText?.slice(0, 60).replace(/\s+/g, " ") ?? "",
      target: (a as HTMLAnchorElement).target,
    }));
    const scripts = Array.from(document.querySelectorAll("script[src]")).map((s) => ({
      src: (s as HTMLScriptElement).src,
    }));
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((s) => ({
      href: (s as HTMLLinkElement).href,
    }));
    return { images, links, scripts, styles };
  });
}

async function inspectInteractions(page: Page) {
  const interactions: Record<string, unknown> = {};

  // CTA clicks: find all links containing "book" / "intro"
  const ctaLinks = await page.locator('a:has-text("Book"), a:has-text("Free Intro"), button:has-text("Book"), button:has-text("Free Intro")').all();
  for (const cta of ctaLinks.slice(0, 5)) {
    const href = await cta.getAttribute("href").catch(() => null);
    const text = await cta.textContent().catch(() => "");
    interactions.ctas = interactions.ctas || [];
    (interactions.ctas as any[]).push({ text: text?.replace(/\s+/g, " ").trim(), href });
  }

  // Try to locate cookie / privacy banner
  const banner = page.locator('[class*="cookie" i], [class*="consent" i], [class*="privacy" i], [id*="cookie" i], [id*="consent" i]').first();
  interactions.cookieBanner = {
    visible: await banner.isVisible().catch(() => false),
    text: await banner.textContent().catch(() => ""),
  };

  // Mobile menu
  const menuToggle = page.locator('[aria-label*="menu" i], button[class*="menu" i], [class*="hamburger" i], [class*="toggle" i]').first();
  interactions.menuToggle = {
    visible: await menuToggle.isVisible().catch(() => false),
    ariaLabel: await menuToggle.getAttribute("aria-label").catch(() => ""),
  };

  // FAQ / accordion
  const accordions = await page.locator('[class*="faq" i] button, [class*="accordion" i] button, details').all();
  interactions.accordionCount = accordions.length;

  return interactions;
}

async function run() {
  await ensureDir();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Capture network / console for widget behavior
  const widgetUrls: string[] = [];
  page.on("framenavigated", (frame) => {
    const url = frame.url();
    if (url && (url.includes("grow.pushpress") || url.includes("pushpress") || url.includes("widget"))) {
      widgetUrls.push(url);
    }
  });

  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);

  // Full page screenshots
  await captureFull(page, "desktop", 1280, 900);
  await captureFull(page, "mobile", 390, 844);

  // Save raw DOM + assets
  const html = await page.content();
  await writeFile(path.join(OUT, "page.html"), html, "utf-8");

  const tree = await getSectionTree(page);
  await writeFile(path.join(OUT, "tree.json"), JSON.stringify(tree, null, 2), "utf-8");

  const assets = await getAssets(page);
  await writeFile(path.join(OUT, "assets.json"), JSON.stringify(assets, null, 2), "utf-8");

  // Computed styles for key categories
  const styleProps = [
    "color",
    "background-color",
    "background-image",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-transform",
    "padding",
    "margin",
    "border-radius",
    "border",
    "box-shadow",
    "display",
    "justify-content",
    "align-items",
    "gap",
  ];
  const styles = {
    header: await getComputedStyles(page, "header, [role='banner']", styleProps),
    hero: await getComputedStyles(page, "section:first-of-type, .hero, [class*='hero' i]", styleProps),
    headings: await getComputedStyles(page, "h1, h2, h3", styleProps),
    buttons: await getComputedStyles(page, "button, .button, a[class*='button' i]", styleProps),
    body: await getComputedStyles(page, "body", styleProps),
    navLinks: await getComputedStyles(page, "nav a", styleProps),
    cards: await getComputedStyles(page, "[class*='card' i]", styleProps),
  };
  await writeFile(path.join(OUT, "styles.json"), JSON.stringify(styles, null, 2), "utf-8");

  // Interactions snapshot
  const interactions = await inspectInteractions(page);
  await writeFile(path.join(OUT, "interactions.json"), JSON.stringify({ ...interactions, widgetUrls }, null, 2), "utf-8");

  // Section crops
  const sectionLocs = await page.locator("body > section, main > section, section").all();
  for (let i = 0; i < Math.min(sectionLocs.length, 15); i++) {
    await captureElement(sectionLocs[i], `section-${i}`);
  }

  await browser.close();
  console.log(`Inspection complete. Output: ${OUT}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
