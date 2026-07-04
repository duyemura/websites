import type { BrowserContext, Page } from "playwright";
import type { BreakpointDelta, ExtractedNav } from "../../types/pipeline-artifacts";

/** Computed theme values read directly from the rendered DOM via getComputedStyle.
 *  Framework-agnostic: works for any site regardless of how styles are applied
 *  (CSS files, JS injection, CSS variables, inline styles, Webflow, etc.). */
export interface ComputedTheme {
  bodyBackground: string;
  bodyColor: string;
  headingFont: string;
  bodyFont: string;
  primaryAccent: string | null;
  /** Raw computed background colors from visible sections, for per-section context. */
  sectionBackgrounds: Array<{ selector: string; background: string }>;
}

export interface CapturedPage {
  path: string;
  media: Array<{
    url: string;
    contentType: string;
    resourceType: "image" | "video" | "font" | "stylesheet";
    bytes: number;
  }>;
  screenshots: { full1440: Buffer; vp375: Buffer; vp768: Buffer };
  content: {
    title: string;
    businessName?: string;
    rawText: string;
    headings: Array<{ level: number; text: string }>;
    navLinks: Array<{ label: string; href: string }>;
    meta: Record<string, string>;
    jsonLd: unknown[];
    iframes: Array<{ src: string; kind: "map" | "schedule" | "form" | "video" | "other" }>;
    videos: Array<{ src: string; poster?: string }>;
  };
  responsive: BreakpointDelta[];
  pixelSamples: Array<{ x: number; y: number; hex: string }>;
  computedTheme: ComputedTheme;
  flags: { needsVisionSegmentation: boolean; isSpa: boolean };
  networkStats: { totalBytes: number; requestCount: number; imageBytes: number };
}

// Mirrors ComputedTheme but declared separately for use inside page.evaluate()
// where outer TypeScript interfaces are not in scope.
type ComputedThemeRaw = {
  bodyBackground: string; bodyColor: string; headingFont: string; bodyFont: string;
  primaryAccent: string | null; sectionBackgrounds: Array<{ selector: string; background: string }>;
};

const SETTLE_MS = 3000;
const SCROLL_STEP_MS = 500;

// Elements whose computed styles we track across viewports.
const TRACKED_STYLE_PROPS = [
  "display",
  "flex-direction",
  "grid-template-columns",
  "font-size",
  "padding",
  "margin",
  "text-align",
  "visibility",
] as const;

export async function capturePage(
  context: BrowserContext,
  url: string,
): Promise<CapturedPage> {
  const page = await context.newPage();
  const media: CapturedPage["media"] = [];
  let totalBytes = 0;
  let requestCount = 0;
  let imageBytes = 0;

  // Step 1: network interception — armed before navigation.
  page.on("response", async (response) => {
    requestCount += 1;
    const ct = response.headers()["content-type"] ?? "";
    let bytes = 0;
    try {
      bytes =
        Number(response.headers()["content-length"] ?? 0) ||
        (await response.body()).byteLength;
    } catch {
      /* streamed/aborted body — size unknown */
    }
    totalBytes += bytes;
    const resourceType = ct.startsWith("image/")
      ? "image"
      : ct.startsWith("video/")
        ? "video"
        : ct.includes("font")
          ? "font"
          : ct.includes("css")
            ? "stylesheet"
            : null;
    if (resourceType === "image") imageBytes += bytes;
    if (resourceType) media.push({ url: response.url(), contentType: ct, resourceType, bytes });
  });

  // Static HTML length BEFORE JS runs — for SPA detection.
  const staticHtmlText = await fetchStaticText(context, url);

  // Step 2: navigate with domcontentloaded + settle (NOT networkidle).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(SETTLE_MS);

  // Step 3: scroll pass.
  await scrollThrough(page);

  // Steps 6 + 8 prep: content + tracked elements at 1440.
  const content = await extractContent(page);
  const styles1440 = await snapshotTrackedStyles(page);
  const full1440 = await page.screenshot({ fullPage: true });

  // Step 8: re-extract at 768 and 375.
  await page.setViewportSize({ width: 768, height: 900 });
  await scrollThrough(page);
  const styles768 = await snapshotTrackedStyles(page);
  const vp768 = await page.screenshot({ fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await scrollThrough(page);
  const styles375 = await snapshotTrackedStyles(page);
  const vp375 = await page.screenshot({ fullPage: true });

  const responsive = diffStyles(styles1440, styles768, styles375);

  // Step 9: pixel sampling from the 1440 screenshot buffer.
  const pixelSamples = await samplePixels(full1440);

  // Step 10: SPA / div-soup detection.
  const renderedText = content.rawText;
  const isSpa = staticHtmlText.length < renderedText.length * 0.3;
  const semanticCount = await page.evaluate(
    () => document.querySelectorAll("header,footer,main,nav,section,article").length,
  );
  const needsVisionSegmentation = isSpa || semanticCount < 3;

  // Step 11: Computed theme — read from live DOM via getComputedStyle.
  // Completely framework-agnostic: captures final rendered values regardless
  // of whether styles came from CSS files, JS injection, CSS variables, etc.
  const computedTheme = await page.evaluate((): ComputedThemeRaw => {
    const body = document.body;
    const bodyStyle = getComputedStyle(body);
    const heading = document.querySelector("h1, h2, h3");
    const headingStyle = heading ? getComputedStyle(heading) : null;

    // Primary accent: the most saturated background color among visible interactive
    // elements. Saturation distinguishes brand colors (high) from near-blacks,
    // near-whites, and grays (low) — which naïve "non-transparent" checks miss.
    const rgbSaturation = (rgb: string): number => {
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 0;
      const r = +(m[1] ?? 0) / 255, g = +(m[2] ?? 0) / 255, b = +(m[3] ?? 0) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return 0;
      const l = (max + min) / 2;
      return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
    };
    let primaryAccent: string | null = null;
    let bestSat = 0.15; // minimum saturation threshold to qualify as a brand color
    const candidateEls = Array.from(
      document.querySelectorAll("a, button, [class*='btn'], [class*='cta'], [class*='button']"),
    ).slice(0, 60);
    for (const el of candidateEls) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width < 40 || rect.height < 24) continue; // skip tiny/invisible elements
      const bg = getComputedStyle(el as Element).backgroundColor;
      const sat = rgbSaturation(bg);
      if (sat > bestSat) { bestSat = sat; primaryAccent = bg; }
    }

    // Section backgrounds: top-level visible sections.
    const sectionBackgrounds: Array<{ selector: string; background: string }> = [];
    const sectionEls = document.querySelectorAll(
      "section, [class*='section'], [class*='hero'], [class*='banner'], main > div, body > div",
    );
    for (const el of Array.from(sectionEls).slice(0, 12)) {
      const rect = el.getBoundingClientRect();
      if (rect.height < 50) continue;
      const bg = getComputedStyle(el as Element).backgroundColor;
      if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
      const cls = typeof (el as HTMLElement).className === "string"
        ? (el as HTMLElement).className.trim().split(/\s+/)[0] : "";
      sectionBackgrounds.push({ selector: cls || el.tagName.toLowerCase(), background: bg });
    }

    return {
      bodyBackground: bodyStyle.backgroundColor,
      bodyColor: bodyStyle.color,
      headingFont: headingStyle?.fontFamily ?? bodyStyle.fontFamily,
      bodyFont: bodyStyle.fontFamily,
      primaryAccent,
      sectionBackgrounds,
    };
  });

  await page.close();
  return {
    path: new URL(url).pathname,
    media,
    screenshots: { full1440, vp375, vp768 },
    content,
    responsive,
    pixelSamples,
    computedTheme,
    flags: { needsVisionSegmentation, isSpa },
    networkStats: { totalBytes, requestCount, imageBytes },
  };
}

async function fetchStaticText(
  context: BrowserContext,
  url: string,
): Promise<string> {
  try {
    // Use Playwright's server-side request API — no CORS, no navigation side
    // effects. This returns the raw HTML before JS executes.
    const response = await context.request.get(url, { timeout: 15_000 });
    if (!response.ok()) return "";
    const html = await response.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.body.scrollHeight);
  const step = await page.evaluate(() => window.innerHeight);
  for (let y = 0; y < height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(SCROLL_STEP_MS);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function extractContent(page: Page): Promise<CapturedPage["content"]> {
  return page.evaluate(() => {
    const meta: Record<string, string> = {};
    for (const el of Array.from(document.querySelectorAll("meta[name],meta[property]"))) {
      const key = el.getAttribute("name") ?? el.getAttribute("property") ?? "";
      const value = el.getAttribute("content") ?? "";
      if (key && value) meta[key] = value;
    }

    const jsonLd: unknown[] = [];
    for (const el of Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )) {
      try {
        jsonLd.push(JSON.parse(el.textContent ?? ""));
      } catch {
        /* malformed */
      }
    }

    // Business name priority: JSON-LD > og:site_name > og:title > <title>. NEVER image alt.
    const ldName = jsonLd
      .flatMap((b) => (Array.isArray(b) ? b : [b]))
      .map((b) => (b as { name?: string })?.name)
      .find((n) => typeof n === "string" && n.length > 0);
    const businessName =
      ldName ?? meta["og:site_name"] ?? meta["og:title"] ?? (document.title || undefined);

    const classify = (src: string): "map" | "schedule" | "form" | "video" | "other" =>
      /google\.[^/]*\/maps|maps\.google/.test(src)
        ? "map"
        : /calendly|schedule|booking|zenplanner|wodify|pushpress/.test(src)
          ? "schedule"
          : /typeform|jotform|forms\./.test(src)
            ? "form"
            : /youtube|vimeo|wistia/.test(src)
              ? "video"
              : "other";

    const nav =
      document.querySelector("nav") ?? document.querySelector("header") ?? document.body;

    return {
      title: document.title,
      businessName,
      rawText: document.body.innerText.replace(/\s+/g, " ").trim(),
      headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
        .map((h) => ({
          level: Number(h.tagName[1]),
          text: (h as HTMLElement).innerText.trim(),
        }))
        .filter((h) => h.text.length > 0),
      navLinks: Array.from(nav.querySelectorAll("a[href]"))
        .map((a) => ({
          label: (a as HTMLElement).innerText.trim(),
          href: a.getAttribute("href") ?? "",
        }))
        .filter((l) => l.label.length > 0),
      meta,
      jsonLd,
      iframes: Array.from(document.querySelectorAll("iframe[src]")).map((f) => {
        const src = f.getAttribute("src") ?? "";
        return { src, kind: classify(src) };
      }),
      videos: Array.from(document.querySelectorAll("video"))
        .map((v) => ({
          src:
            v.getAttribute("src") ??
            v.querySelector("source")?.getAttribute("src") ??
            "",
          poster: v.getAttribute("poster") ?? undefined,
        }))
        .filter((v) => v.src.length > 0),
    };
  });
}

interface TrackedStyle {
  selector: string;
  styles: Record<string, string>;
}

async function snapshotTrackedStyles(page: Page): Promise<TrackedStyle[]> {
  return page.evaluate((props) => {
    // Track: large visible containers (top-level layout blocks + their direct
    // children with ids/classes).
    const candidates = new Set<Element>();
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 80 && (el.id || el.className)) candidates.add(el);
      if (candidates.size >= 120) break;
    }
    const selectorFor = (el: Element): string => {
      if (el.id) return `#${el.id}`;
      const cls =
        typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
      return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
    };
    return Array.from(candidates).map((el) => {
      const computed = getComputedStyle(el);
      const styles: Record<string, string> = {};
      for (const p of props) styles[p] = computed.getPropertyValue(p);
      return { selector: selectorFor(el), styles };
    });
  }, TRACKED_STYLE_PROPS as unknown as string[]);
}

function diffStyles(
  s1440: TrackedStyle[],
  s768: TrackedStyle[],
  s375: TrackedStyle[],
): BreakpointDelta[] {
  const bySelector = (arr: TrackedStyle[]) =>
    new Map(arr.map((s) => [s.selector, s.styles]));
  const m768 = bySelector(s768);
  const m375 = bySelector(s375);
  const deltas: BreakpointDelta[] = [];
  for (const { selector, styles } of s1440) {
    for (const [property, at1440] of Object.entries(styles)) {
      const v768 = m768.get(selector)?.[property];
      const v375 = m375.get(selector)?.[property];
      if ((v768 !== undefined && v768 !== at1440) || (v375 !== undefined && v375 !== at1440)) {
        deltas.push({
          selector,
          property,
          at1440,
          at768: v768 !== at1440 ? v768 : undefined,
          at375: v375 !== at1440 ? v375 : undefined,
        });
      }
    }
  }
  return deltas;
}

/**
 * Extract deterministic nav data from the rendered page at 1440px viewport.
 * Reads computed styles directly from the DOM — no LLM involved. Returns null
 * if no nav/header element is found on the page.
 */
export async function extractNavData(page: Page): Promise<ExtractedNav | null> {
  // Ensure we're at desktop width for the nav extraction.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  type NavLinkRaw = { label: string; href: string; children?: NavLinkRaw[] };

  type ExtractedNavRaw = {
    position: "top-fixed" | "top-sticky" | "top-static" | "left-sidebar";
    background: string;
    textColor: string;
    logo: { type: "image" | "text"; value: string; alt?: string };
    links: NavLinkRaw[];
    cta?: { label: string; href: string; background: string; color: string; borderRadius: string };
    hasMobileToggle: boolean;
    mobileMenuBackground: string;
  };

  const result = await page.evaluate((): ExtractedNavRaw | null => {
    // ---- find the nav/header element ----
    // Prefer the outermost banner/header container which includes BOTH the logo
    // and the links — many frameworks (Webflow, etc.) separate logo and nav into
    // sibling elements inside a parent wrapper rather than inside <nav> itself.
    const navEl =
      document.querySelector('[role="banner"]') ??
      document.querySelector("header") ??
      document.querySelector("nav") ??
      document.querySelector('[role="navigation"]');
    if (!navEl) return null;

    const navStyle = getComputedStyle(navEl as Element);

    // ---- position ----
    const pos = navStyle.position;
    const position: "top-fixed" | "top-sticky" | "top-static" | "left-sidebar" =
      pos === "fixed"
        ? "top-fixed"
        : pos === "sticky"
          ? "top-sticky"
          : navStyle.left !== "auto" && parseInt(navStyle.width) < 300
            ? "left-sidebar"
            : "top-static";

    const background = navStyle.backgroundColor;
    const textColor = navStyle.color;

    // ---- logo ----
    // Logo is usually the first <img> in the nav, or a brand link with logo class.
    // Look left-side first (low x position relative to navbar width).
    const navRect = navEl.getBoundingClientRect();
    const allImgs = Array.from(navEl.querySelectorAll("img")) as HTMLImageElement[];
    // Prefer the image in the left third of the nav (logo area)
    const logoImg = allImgs.find(img => {
      const r = img.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.left < navRect.left + navRect.width * 0.4;
    }) ?? allImgs[0] ?? null;

    let logo: { type: "image" | "text"; value: string; alt?: string };
    if (logoImg) {
      logo = { type: "image", value: logoImg.src, alt: logoImg.alt || undefined };
    } else {
      // Text logo: brand link or first prominent link in left area
      const brandEl = (
        navEl.querySelector('[class*="brand"],[class*="logo"],[class*="Brand"],[class*="Logo"]') ??
        Array.from(navEl.querySelectorAll("a")).find(a => {
          const r = (a as HTMLElement).getBoundingClientRect();
          return r.left < navRect.left + navRect.width * 0.4 && r.width > 20;
        })
      ) as HTMLElement | null;
      logo = { type: "text", value: brandEl?.innerText?.trim() ?? "" };
    }

    // ---- saturation helper (same as computedTheme) ----
    const rgbSaturation = (rgb: string): number => {
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 0;
      const r = +(m[1] ?? 0) / 255, g = +(m[2] ?? 0) / 255, b = +(m[3] ?? 0) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return 0;
      const l = (max + min) / 2;
      return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
    };

    // ---- CTA: most-saturated background button/link in nav ----
    let cta: ExtractedNavRaw["cta"] | undefined;
    let bestSat = 0.15;
    const ctaCandidates = Array.from(
      navEl.querySelectorAll("a, button, [class*='btn'], [class*='cta'], [class*='button']"),
    );
    for (const el of ctaCandidates) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width < 40 || rect.height < 16) continue;
      const s = getComputedStyle(el as Element);
      const sat = rgbSaturation(s.backgroundColor);
      if (sat > bestSat) {
        bestSat = sat;
        cta = {
          label: (el as HTMLElement).innerText?.trim() ?? "",
          href: (el as HTMLAnchorElement).href ?? (el as HTMLElement).getAttribute("href") ?? "#",
          background: s.backgroundColor,
          color: s.color,
          borderRadius: s.borderRadius,
        };
      }
    }

    // ---- links: generic extraction that works without <ul>/<li> ----
    // Many frameworks (Webflow, etc.) use flat <a> + dropdown wrapper divs.
    // Strategy: find the nav menu container, then extract top-level link items.
    function extractLinksFromEl(container: Element, isRoot = false): NavLinkRaw[] {
      const result: NavLinkRaw[] = [];
      const seen = new Set<string>();

      // innerText is layout-dependent and returns "" for display:none elements
      // (closed dropdowns). Always use textContent for link labels.
      const getText = (el: Element) => el.textContent?.trim() ?? "";

      // Walk direct children looking for link-like elements
      for (const child of Array.from(container.children)) {
        const tag = child.tagName.toLowerCase();

        // <li> — classic pattern
        if (tag === "li") {
          const anchor = child.querySelector(":scope > a[href]") as HTMLAnchorElement | null;
          if (!anchor) continue;
          const label = getText(anchor);
          const href = anchor.getAttribute("href") ?? "";
          if (!label || seen.has(label)) continue;
          seen.add(label);
          const subList = child.querySelector(":scope > ul, :scope > ol, :scope > [class*='dropdown'], :scope > [class*='submenu']");
          const children = subList ? extractLinksFromEl(subList) : undefined;
          result.push({ label, href, ...(children?.length ? { children } : {}) });
          continue;
        }

        // <a href> — direct link (use textContent so hidden brand links don't count)
        if (tag === "a") {
          const a = child as HTMLAnchorElement;
          const href = a.getAttribute("href") ?? "";
          if (!href) continue;
          const label = getText(a);
          if (!label || seen.has(label)) continue;
          // Skip if in logo area (left 30% of nav) — only at root level
          if (isRoot) {
            const r = a.getBoundingClientRect();
            if (r.left < navRect.left + navRect.width * 0.3) continue;
          }
          seen.add(label);
          result.push({ label, href });
          continue;
        }

        // Dropdown wrapper div (Webflow w-dropdown, Bootstrap dropdown, etc.)
        if (tag === "div") {
          // Find the trigger — the visible label (toggle div, button, or direct link)
          const trigger = child.querySelector(
            ":scope > [class*='toggle'], :scope > [class*='trigger'], :scope > button, :scope > a[href]"
          ) as HTMLElement | null;
          if (trigger) {
            // Standard dropdown: trigger + panel sibling
            const label = getText(trigger);
            const href = (trigger as HTMLAnchorElement).getAttribute("href") ?? "#";
            if (label && !seen.has(label)) {
              seen.add(label);
              // Panel: direct child that isn't the trigger and contains links
              const panel = Array.from(child.children).find(
                c => c !== trigger && c.querySelector("a[href]")
              ) as Element | undefined;
              const children = panel ? extractLinksFromEl(panel) : undefined;
              result.push({ label, href, ...(children?.length ? { children } : {}) });
            }
          } else {
            // No trigger — transparent link wrapper (e.g. Webflow CMS list, flex div).
            // Collect ALL links from the subtree generically — works for any depth of
            // wrapper divs whether the site uses w-dyn-list, flex containers, etc.
            const deepLinks = Array.from(child.querySelectorAll("a[href]")) as HTMLAnchorElement[];
            for (const deepLink of deepLinks) {
              const label = getText(deepLink);
              const href = deepLink.getAttribute("href") ?? "";
              if (label && !seen.has(label)) {
                seen.add(label);
                result.push({ label, href });
              }
            }
          }
        }
      }
      return result;
    }

    // Find the menu container: prefer <nav> inside the banner, or the banner itself
    const menuEl =
      navEl.querySelector("nav") ??
      navEl.querySelector('[role="navigation"]') ??
      navEl.querySelector("ul")?.parentElement ??
      navEl;
    const links = extractLinksFromEl(menuEl, true);

    // ---- mobile toggle ----
    const toggleEl = navEl.querySelector(
      '[class*="hamburger"],[class*="menu-toggle"],[class*="nav-toggle"],[aria-controls],[class*="mobile-nav"],[class*="burger"]',
    );
    const hasMobileToggle = toggleEl !== null;

    // ---- mobile menu background ----
    const mobileMenuEl = document.querySelector(
      '[class*="mobile-menu"],[class*="drawer"],[class*="mobile-nav"],[class*="nav-drawer"]',
    ) as HTMLElement | null;
    const mobileMenuBackground = mobileMenuEl
      ? getComputedStyle(mobileMenuEl).backgroundColor
      : background;

    return {
      position,
      background,
      textColor,
      logo,
      links,
      cta,
      hasMobileToggle,
      mobileMenuBackground,
    };
  });

  return result;
}

async function samplePixels(
  screenshot: Buffer,
): Promise<Array<{ x: number; y: number; hex: string }>> {
  const sharp = (await import("sharp")).default;
  const image = sharp(screenshot);
  const { data: raw, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height) return [];
  const stride = channels; // 3 (RGB) or 4 (RGBA) depending on source PNG
  const samples: Array<{ x: number; y: number; hex: string }> = [];
  const cols = 6;
  const rows = 12;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(((c + 0.5) / cols) * width);
      const y = Math.floor(((r + 0.5) / rows) * height);
      const idx = (y * width + x) * stride;
      const hex = `#${[raw[idx], raw[idx + 1], raw[idx + 2]]
        .map((v) => (v ?? 0).toString(16).padStart(2, "0"))
        .join("")}`;
      samples.push({ x, y, hex });
    }
  }
  return samples;
}
