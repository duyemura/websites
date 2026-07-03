import type { BrowserContext, Page } from "playwright";
import type { BreakpointDelta } from "../../types/pipeline-artifacts";

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
  flags: { needsVisionSegmentation: boolean; isSpa: boolean };
  networkStats: { totalBytes: number; requestCount: number; imageBytes: number };
}

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

  await page.close();
  return {
    path: new URL(url).pathname,
    media,
    screenshots: { full1440, vp375, vp768 },
    content,
    responsive,
    pixelSamples,
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
      ldName ?? meta["og:site_name"] ?? meta["og:title"] ?? document.title ?? undefined;

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
