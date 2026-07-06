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
    resourceType: "image" | "video" | "font" | "stylesheet" | "lottie-json";
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
    primaryCta?: { label: string; href: string };
    lottieUrls: string[];
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

/**
 * Detect Lottie animation JSON URLs on a loaded Playwright page.
 * Checks for:
 *   1. <lottie-player src="..."> web components
 *   2. lottie.loadAnimation({ path: "..." }) calls in inline scripts
 *   3. data-src attributes pointing to .json files
 *   4. <script src="...lottie..."> script tags (signals Lottie is used on the page)
 * Returns deduplicated absolute JSON source URLs.
 */
export async function detectLottieAssets(page: Page): Promise<string[]> {
  const pageUrl = page.url();
  const found = await page.evaluate((baseUrl: string): string[] => {
    const urls = new Set<string>();

    // 1. <lottie-player src="...">
    for (const el of Array.from(document.querySelectorAll("lottie-player[src]"))) {
      const src = el.getAttribute("src");
      if (src) {
        try { urls.add(new URL(src, baseUrl).href); } catch { urls.add(src); }
      }
    }

    // 2. data-src attributes pointing to .json
    for (const el of Array.from(document.querySelectorAll("[data-src]"))) {
      const src = el.getAttribute("data-src") ?? "";
      if (src.endsWith(".json") || src.includes("lottie")) {
        try { urls.add(new URL(src, baseUrl).href); } catch { urls.add(src); }
      }
    }

    // 3. Inline script text: lottie.loadAnimation({ path: "..." })
    for (const script of Array.from(document.querySelectorAll("script:not([src])"))) {
      const text = script.textContent ?? "";
      const pathMatches = text.matchAll(/loadAnimation\s*\(\s*\{[^}]*path\s*:\s*["']([^"']+\.json[^"']*)/g);
      for (const m of pathMatches) {
        if (m[1]) { try { urls.add(new URL(m[1], baseUrl).href); } catch { urls.add(m[1]); } }
      }
    }

    return Array.from(urls);
  }, pageUrl);
  return found;
}

/**
 * Detect Lottie JSON from network responses captured during page load.
 * This is called from the response listener with the response URL and body.
 * Returns true if the response looks like a Lottie animation JSON.
 */
export function isLottieResponse(url: string, contentType: string, bodyText?: string): boolean {
  const lottieInUrl = /lottie/i.test(url) && contentType.includes("application/json");
  if (lottieInUrl) return true;
  if (bodyText && contentType.includes("application/json")) {
    // Lottie JSON must have top-level keys: v, fr, ip, op, layers
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      return (
        "v" in parsed &&
        "fr" in parsed &&
        "ip" in parsed &&
        "op" in parsed &&
        "layers" in parsed
      );
    } catch {
      return false;
    }
  }
  return false;
}

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
  const networkLottieUrls: string[] = [];
  let totalBytes = 0;
  let requestCount = 0;
  let imageBytes = 0;

  // Step 1: network interception — armed before navigation.
  page.on("response", async (response) => {
    requestCount += 1;
    const ct = response.headers()["content-type"] ?? "";
    let bytes = 0;
    let bodyText: string | undefined;
    try {
      const body = await response.body();
      bytes = Number(response.headers()["content-length"] ?? 0) || body.byteLength;
      // Only read body text for small JSON responses (Lottie detection).
      if (ct.includes("application/json") && body.byteLength < 500_000) {
        bodyText = body.toString("utf8");
      }
    } catch {
      /* streamed/aborted body — size unknown */
    }
    totalBytes += bytes;
    // Detect Lottie JSON before determining standard resourceType.
    if (isLottieResponse(response.url(), ct, bodyText)) {
      media.push({ url: response.url(), contentType: ct, resourceType: "lottie-json", bytes });
      networkLottieUrls.push(response.url());
      return;
    }
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

  // Step 11a: Detect Lottie assets from the DOM (web components, inline scripts, data-src).
  // Reset to 1440 viewport — capturePage leaves the page at 375 after mobile screenshots.
  await page.setViewportSize({ width: 1440, height: 900 });
  const domLottieUrls = await detectLottieAssets(page);
  // Merge DOM-detected and network-detected URLs, deduplicating.
  const allLottieUrls = Array.from(new Set([...networkLottieUrls, ...domLottieUrls]));

  // Step 11: Computed theme — read from live DOM via getComputedStyle.
  // Completely framework-agnostic: captures final rendered values regardless
  // of whether styles came from CSS files, JS injection, CSS variables, etc.
  // String literal avoids esbuild __name polyfill leaking into browser context.
  const COMPUTED_THEME_SCRIPT = String.raw`(function() {
    var body = document.body;
    var bodyStyle = getComputedStyle(body);
    var heading = document.querySelector("h1, h2, h3");
    var headingStyle = heading ? getComputedStyle(heading) : null;

    function rgbSaturation(rgb) {
      var m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 0;
      var r = +m[1] / 255, g = +m[2] / 255, b = +m[3] / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return 0;
      var l = (max + min) / 2;
      return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
    }

    var primaryAccent = null;
    var bestSat = 0.15;
    var candidateEls = Array.from(
      document.querySelectorAll("a, button, [class*='btn'], [class*='cta'], [class*='button']")
    ).slice(0, 60);
    for (var i = 0; i < candidateEls.length; i++) {
      var el = candidateEls[i];
      var rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 24) continue;
      var bg = getComputedStyle(el).backgroundColor;
      var sat = rgbSaturation(bg);
      if (sat > bestSat) { bestSat = sat; primaryAccent = bg; }
    }

    var sectionBackgrounds = [];
    var sectionEls = Array.from(document.querySelectorAll(
      "section, [class*='section'], [class*='hero'], [class*='banner'], main > div, body > div"
    )).slice(0, 12);
    for (var j = 0; j < sectionEls.length; j++) {
      var sel = sectionEls[j];
      var selRect = sel.getBoundingClientRect();
      if (selRect.height < 50) continue;
      var selBg = getComputedStyle(sel).backgroundColor;
      if (!selBg || selBg === "rgba(0, 0, 0, 0)" || selBg === "transparent") continue;
      var cls = typeof sel.className === "string" ? sel.className.trim().split(/\s+/)[0] : "";
      sectionBackgrounds.push({ selector: cls || sel.tagName.toLowerCase(), background: selBg });
    }

    return {
      bodyBackground: bodyStyle.backgroundColor,
      bodyColor: bodyStyle.color,
      headingFont: headingStyle ? headingStyle.fontFamily : bodyStyle.fontFamily,
      bodyFont: bodyStyle.fontFamily,
      primaryAccent: primaryAccent,
      sectionBackgrounds: sectionBackgrounds,
    };
  })()`;
  const computedTheme = await page.evaluate(COMPUTED_THEME_SCRIPT as unknown as () => ComputedThemeRaw);

  await page.close();
  return {
    path: new URL(url).pathname,
    media,
    screenshots: { full1440, vp375, vp768 },
    content: { ...content, lottieUrls: allLottieUrls },
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

// String literal so esbuild/tsx __name polyfills don't leak into the browser context.
const EXTRACT_CONTENT_SCRIPT = String.raw`(function() {
  var meta = {};
  Array.from(document.querySelectorAll("meta[name],meta[property]")).forEach(function(el) {
    var key = el.getAttribute("name") || el.getAttribute("property") || "";
    var value = el.getAttribute("content") || "";
    if (key && value) meta[key] = value;
  });

  var jsonLd = [];
  Array.from(document.querySelectorAll('script[type="application/ld+json"]')).forEach(function(el) {
    try { jsonLd.push(JSON.parse(el.textContent || "")); } catch(e) {}
  });

  var ldName = jsonLd
    .reduce(function(a, b) { return a.concat(Array.isArray(b) ? b : [b]); }, [])
    .map(function(b) { return b && b.name; })
    .find(function(n) { return typeof n === "string" && n.length > 0; });
  var businessName = ldName || meta["og:site_name"] || meta["og:title"] || document.title || undefined;

  var nav = document.querySelector("nav") || document.querySelector("header") || document.body;

  var h1 = document.querySelector("h1") || document.querySelector("h2");
  var primaryCta = undefined;
  if (h1) {
    var h1Rect = h1.getBoundingClientRect();
    var CTA_RE = /\b(btn|button|cta|action|primary|get.?started|sign.?up|join|enroll|book|schedule|free|start|tour)\b/i;
    var best = undefined;
    Array.from(document.querySelectorAll("a[href],button")).forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 28) return;
      var href = el.getAttribute("href") || "";
      if (href.startsWith("tel:") || href.startsWith("mailto:")) return;
      var text = (el.textContent || "").trim();
      if (!text || text.length > 60) return;
      var cls = (el.className || "").toString();
      var classScore = CTA_RE.test(cls) ? 10 : 0;
      var distScore = Math.max(0, 5 - Math.abs(rect.top - h1Rect.bottom) / 200);
      var score = classScore + distScore;
      if (!best || score > best.score) best = { label: text, href: href, score: score };
    });
    if (best) primaryCta = { label: best.label, href: best.href };
  }

  return {
    title: document.title,
    businessName: businessName,
    rawText: document.body.innerText.replace(/\s+/g, " ").trim(),
    headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .map(function(h) { return { level: Number(h.tagName[1]), text: (h.innerText || "").trim() }; })
      .filter(function(h) { return h.text.length > 0; }),
    navLinks: Array.from(nav.querySelectorAll("a[href]"))
      .map(function(a) { return { label: (a.innerText || "").trim(), href: a.getAttribute("href") || "" }; })
      .filter(function(l) { return l.label.length > 0; }),
    meta: meta,
    jsonLd: jsonLd,
    primaryCta: primaryCta,
    iframes: Array.from(document.querySelectorAll("iframe[src]")).map(function(f) {
      var src = f.getAttribute("src") || "";
      var kind = /google\.[^/]*\/maps|maps\.google/.test(src) ? "map"
        : /calendly|schedule|booking|zenplanner|wodify|pushpress/.test(src) ? "schedule"
        : /typeform|jotform|forms\./.test(src) ? "form"
        : /youtube|vimeo|wistia/.test(src) ? "video"
        : "other";
      return { src: src, kind: kind };
    }),
    videos: Array.from(document.querySelectorAll("video"))
      .map(function(v) {
        var src = v.getAttribute("src") || (v.querySelector("source") ? v.querySelector("source").getAttribute("src") : "") || "";
        return { src: src, poster: v.getAttribute("poster") || undefined };
      })
      .filter(function(v) { return v.src.length > 0; }),
  };
})()`;

async function extractContent(page: Page): Promise<Omit<CapturedPage["content"], "lottieUrls">> {
  return page.evaluate(EXTRACT_CONTENT_SCRIPT as unknown as () => Omit<CapturedPage["content"], "lottieUrls">);
}

interface TrackedStyle {
  selector: string;
  styles: Record<string, string>;
}

async function snapshotTrackedStyles(page: Page): Promise<TrackedStyle[]> {
  // String literal avoids esbuild __name polyfill leaking into browser context.
  const propsJson = JSON.stringify([...TRACKED_STYLE_PROPS]);
  return page.evaluate(`(function() {
    var props = ${propsJson};
    var candidates = [];
    var els = Array.from(document.querySelectorAll("body *"));
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var rect = el.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 80 && (el.id || el.className)) {
        candidates.push(el);
        if (candidates.length >= 120) break;
      }
    }
    return candidates.map(function(el) {
      var sel = el.id ? "#" + el.id
        : (typeof el.className === "string" && el.className.trim()
          ? el.tagName.toLowerCase() + "." + el.className.trim().split(/\\s+/)[0]
          : el.tagName.toLowerCase());
      var computed = getComputedStyle(el);
      var styles = {};
      for (var j = 0; j < props.length; j++) styles[props[j]] = computed.getPropertyValue(props[j]);
      return { selector: sel, styles: styles };
    });
  })()`) as Promise<TrackedStyle[]>;
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

  // String literal avoids esbuild __name polyfill leaking into browser context
  // (named arrow functions and named function declarations inside page.evaluate
  // both trigger __name polyfills that don't exist in the browser).
  const EXTRACT_NAV_SCRIPT = String.raw`(function() {
    var navEl =
      document.querySelector('[role="banner"]') ||
      document.querySelector("header") ||
      document.querySelector("nav") ||
      document.querySelector('[role="navigation"]');
    if (!navEl) return null;

    var navStyle = getComputedStyle(navEl);

    // ---- position ----
    var pos = navStyle.position;
    var position =
      pos === "fixed" ? "top-fixed"
      : pos === "sticky" ? "top-sticky"
      : navStyle.left !== "auto" && parseInt(navStyle.width) < 300 ? "left-sidebar"
      : "top-static";

    var background = navStyle.backgroundColor;
    var firstTextLink = null;
    var allAs = Array.from(navEl.querySelectorAll("a"));
    for (var i = 0; i < allAs.length; i++) {
      var t = (allAs[i].innerText || "").trim();
      if (t && t.length > 1) { firstTextLink = allAs[i]; break; }
    }
    var textColor = firstTextLink ? getComputedStyle(firstTextLink).color : navStyle.color;

    // ---- logo ----
    var navRect = navEl.getBoundingClientRect();
    var allImgs = Array.from(navEl.querySelectorAll("img"));
    var logoImg = null;
    for (var li = 0; li < allImgs.length; li++) {
      var ir = allImgs[li].getBoundingClientRect();
      if (ir.width > 8 && ir.height > 8 && ir.left < navRect.left + navRect.width * 0.4) {
        logoImg = allImgs[li]; break;
      }
    }
    if (!logoImg && allImgs.length > 0) logoImg = allImgs[0];

    var logo;
    if (logoImg) {
      logo = { type: "image", value: logoImg.src, alt: logoImg.alt || undefined };
    } else {
      var brandEl =
        navEl.querySelector('[class*="brand"],[class*="logo"],[class*="Brand"],[class*="Logo"]') ||
        (function() {
          var navAnchors = Array.from(navEl.querySelectorAll("a"));
          for (var bi = 0; bi < navAnchors.length; bi++) {
            var br = navAnchors[bi].getBoundingClientRect();
            if (br.left < navRect.left + navRect.width * 0.4 && br.width > 20) return navAnchors[bi];
          }
          return null;
        })();
      logo = { type: "text", value: brandEl ? (brandEl.innerText || "").trim() : "" };
    }

    // ---- saturation helper ----
    function rgbSaturation(rgb) {
      var m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 0;
      var r = +m[1] / 255, g = +m[2] / 255, b = +m[3] / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return 0;
      var l = (max + min) / 2;
      return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
    }

    // ---- CTA ----
    var NAV_CTA_RE = /\b(btn|button|cta|action|primary|get.?started|sign.?up|join|enroll|book|schedule|free|start)\b/i;
    var cta = undefined;
    var bestCtaScore = 0;
    var ctaEls = Array.from(navEl.querySelectorAll("a[href], button"));
    for (var ci = 0; ci < ctaEls.length; ci++) {
      var cel = ctaEls[ci];
      var crect = cel.getBoundingClientRect();
      if (crect.width < 40 || crect.height < 16) continue;
      var cs = getComputedStyle(cel);
      var cls = (cel.className || "").toString();
      var classScore = NAV_CTA_RE.test(cls) ? 10 : 0;
      var bgColor = cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor
        : ((cs.background.match(/rgba?\([^)]+\)/) || [])[0] || "");
      var sat = rgbSaturation(bgColor || cs.backgroundColor);
      var satScore = sat > 0.15 ? Math.round(sat * 5) : 0;
      var score = classScore + satScore;
      if (score > bestCtaScore) {
        bestCtaScore = score;
        var bg = bgColor || cs.backgroundColor;
        cta = {
          label: (cel.innerText || "").trim(),
          href: cel.href || cel.getAttribute("href") || "#",
          background: bg,
          color: cs.color,
          borderRadius: cs.borderRadius,
        };
      }
    }

    // ---- links ----
    function getText(el) { return (el.textContent || "").trim(); }

    function extractLinksFromEl(container, isRoot) {
      var res = [];
      var seen = {};
      var children = Array.from(container.children);
      for (var k = 0; k < children.length; k++) {
        var child = children[k];
        var tag = child.tagName.toLowerCase();

        if (tag === "li") {
          var anchor = child.querySelector(":scope > a[href]");
          if (!anchor) continue;
          var label = getText(anchor);
          var href = anchor.getAttribute("href") || "";
          if (!label || seen[label]) continue;
          seen[label] = true;
          var subList = child.querySelector(":scope > ul, :scope > ol, :scope > [class*='dropdown'], :scope > [class*='submenu']");
          var subChildren = subList ? extractLinksFromEl(subList, false) : undefined;
          var item = { label: label, href: href };
          if (subChildren && subChildren.length) item.children = subChildren;
          res.push(item);
          continue;
        }

        if (tag === "a") {
          var ahref = child.getAttribute("href") || "";
          if (!ahref) continue;
          var alabel = getText(child);
          if (!alabel || seen[alabel]) continue;
          if (isRoot) {
            var ar = child.getBoundingClientRect();
            if (ar.left < navRect.left + navRect.width * 0.3) continue;
          }
          seen[alabel] = true;
          res.push({ label: alabel, href: ahref });
          continue;
        }

        if (tag === "div") {
          var trigger = child.querySelector(
            ":scope > [class*='toggle'], :scope > [class*='trigger'], :scope > button, :scope > a[href]"
          );
          if (trigger) {
            var tlabel = getText(trigger);
            var thref = trigger.getAttribute("href") || "#";
            if (tlabel && !seen[tlabel]) {
              seen[tlabel] = true;
              var panel = null;
              var divChildren = Array.from(child.children);
              for (var p = 0; p < divChildren.length; p++) {
                if (divChildren[p] !== trigger && divChildren[p].querySelector("a[href]")) {
                  panel = divChildren[p]; break;
                }
              }
              var pChildren = panel ? extractLinksFromEl(panel, false) : undefined;
              var ditem = { label: tlabel, href: thref };
              if (pChildren && pChildren.length) ditem.children = pChildren;
              res.push(ditem);
            }
          } else {
            var deepLinks = Array.from(child.querySelectorAll("a[href]"));
            for (var dl = 0; dl < deepLinks.length; dl++) {
              var dlabel = getText(deepLinks[dl]);
              var dhref = deepLinks[dl].getAttribute("href") || "";
              if (dlabel && !seen[dlabel]) {
                seen[dlabel] = true;
                res.push({ label: dlabel, href: dhref });
              }
            }
          }
        }
      }
      return res;
    }

    var menuEl =
      navEl.querySelector("nav") ||
      navEl.querySelector('[role="navigation"]') ||
      (navEl.querySelector("ul") ? navEl.querySelector("ul").parentElement : null) ||
      navEl;
    var links = extractLinksFromEl(menuEl, true);

    // ---- mobile toggle ----
    var toggleEl = navEl.querySelector(
      '[class*="hamburger"],[class*="menu-toggle"],[class*="nav-toggle"],[aria-controls],[class*="mobile-nav"],[class*="burger"]'
    );
    var hasMobileToggle = toggleEl !== null;

    // ---- mobile menu background ----
    var mobileMenuEl = document.querySelector(
      '[class*="mobile-menu"],[class*="drawer"],[class*="mobile-nav"],[class*="nav-drawer"]'
    );
    var mobileMenuBackground = mobileMenuEl
      ? getComputedStyle(mobileMenuEl).backgroundColor
      : background;

    return {
      position: position,
      background: background,
      textColor: textColor,
      logo: logo,
      links: links,
      cta: cta,
      hasMobileToggle: hasMobileToggle,
      mobileMenuBackground: mobileMenuBackground,
    };
  })()`;
  const result = await page.evaluate(EXTRACT_NAV_SCRIPT as unknown as () => ExtractedNavRaw | null);

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
