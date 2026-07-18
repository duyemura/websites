import { chromium } from "playwright";
import type {
  SectionExtractArtifact,
  SectionExtractPage,
  SectionExtractEntry,
  SectionImageRef,
  SectionTextNode,
  BBox,
} from "../../types/pipeline-artifacts";
import type { SegmentArtifact, SegmentSection } from "../../types/pipeline-artifacts";
import type { ContractArtifact } from "../../types/section-contract";

const VIEWPORT_WIDTH = 1440;
const MAX_OUTER_HTML_BYTES = 100_000;
const MIN_CONFIDENCE = 0.5;

/** Computed CSS properties to capture for each section element. */
const COMPUTED_STYLE_PROPS = [
  "backgroundColor",
  "backgroundImage",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "padding",
  "margin",
  "display",
  "flexDirection",
  "gridTemplateColumns",
  "gap",
  "textAlign",
  "alignItems",
  "justifyContent",
  "borderRadius",
  "boxShadow",
] as const;

export interface SectionExtractInput {
  siteUuid: string;
  sourceUrl: string;
  segment: SegmentArtifact;
  contract: ContractArtifact;
}

/** DOM extraction result returned from page.evaluate(). */
interface DomExtractionResult {
  outerHTML: string;
  computedStyles: Record<string, string>;
  images: SectionImageRef[];
  textNodes: SectionTextNode[];
  actualBoundingBox: BBox;
}

export async function runSectionExtractService(
  input: SectionExtractInput,
): Promise<SectionExtractArtifact> {
  const browser = await chromium.launch({ headless: true });

  try {
    const pages: SectionExtractPage[] = [];

    for (const segPage of input.segment.pages) {
      // Find the corresponding contract page for archetype info
      const contractPage = input.contract.pages.find((p) => p.path === segPage.path);

      const pageUrl = resolvePageUrl(input.sourceUrl, segPage.path);

      const extractedSections = await extractPageSections(
        browser,
        pageUrl,
        segPage.sections,
        contractPage?.sections ?? [],
      );

      pages.push({
        path: segPage.path,
        url: pageUrl,
        sections: extractedSections,
      });
    }

    return {
      siteUuid: input.siteUuid,
      sourceUrl: input.sourceUrl,
      capturedAt: new Date().toISOString(),
      pages,
    };
  } finally {
    await browser.close();
  }
}

function resolvePageUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  if (path === "/" || path === "") return base + "/";
  return `${base}${path}`;
}

async function extractPageSections(
  browser: import("playwright").Browser,
  pageUrl: string,
  segSections: SegmentSection[],
  contractSections: import("../../types/section-contract").SectionContract[],
): Promise<SectionExtractEntry[]> {
  const page = await browser.newPage();

  try {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 900 });
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60_000 });

    // Disable animations to get stable layout
    await page.addStyleTag({
      content: `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`,
    });

    const results: SectionExtractEntry[] = [];

    for (let i = 0; i < segSections.length; i++) {
      const segSection = segSections[i];

      if (!segSection || segSection.confidence < MIN_CONFIDENCE) continue;

      // Find matching contract section for archetype
      const contractSection = contractSections[i];
      const archetype = contractSection?.layout.archetype ?? "unknown";

      const bbox = segSection.boundingBox;
      const centerX = Math.round(bbox.x + bbox.width / 2);
      const centerY = Math.round(bbox.y + bbox.height / 2);

      // Scroll to the section center before probing
      await page.evaluate(
        (y: number) => window.scrollTo(0, Math.max(0, y - 400)),
        centerY,
      );
      // Small pause for lazy-loaded content
      await page.waitForTimeout(150);

      let extraction: DomExtractionResult | null = null;
      try {
        // Get current scroll position to compute viewport-relative y
        const scrollY = await page.evaluate(() => window.scrollY);
        const vpY = centerY - scrollY;

        extraction = await page.evaluate(
          domExtractAtPoint,
          {
            x: centerX,
            y: vpY,
            targetHeight: bbox.height,
            props: [...COMPUTED_STYLE_PROPS],
          },
        );
      } catch (err) {
        console.warn(
          `[section-extract] Failed to extract section ${segSection.id} on ${pageUrl}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!extraction) continue;

      // Truncate outerHTML to 100 KB
      const outerHTML =
        extraction.outerHTML.length > MAX_OUTER_HTML_BYTES
          ? extraction.outerHTML.slice(0, MAX_OUTER_HTML_BYTES) + "<!-- truncated -->"
          : extraction.outerHTML;

      results.push({
        id: segSection.id,
        tag: segSection.tag,
        archetype,
        outerHTML,
        computedStyles: extraction.computedStyles,
        images: extraction.images,
        textNodes: extraction.textNodes,
        boundingBox: extraction.actualBoundingBox,
      });
    }

    return results;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Browser-side extraction function — must be fully self-contained.
// Playwright serialises the function body and re-evaluates it in the page
// context, so ALL helper logic must live INSIDE this function.
// No external references, no TypeScript annotations on inner functions.
// ---------------------------------------------------------------------------

function domExtractAtPoint(args: {
  x: number;
  y: number;
  targetHeight: number;
  props: string[];
}): {
  outerHTML: string;
  computedStyles: Record<string, string>;
  images: Array<{ src: string; alt?: string; isBackground: boolean }>;
  textNodes: Array<{ text: string; tag: string; className: string }>;
  actualBoundingBox: { x: number; y: number; width: number; height: number };
} | null {
  const { x, y, targetHeight, props } = args;

  // ---- findSectionContainer (inlined) ------------------------------------
  function findSectionContainer(start: HTMLElement): HTMLElement {
    let best = start;
    let bestDelta = Math.abs(start.getBoundingClientRect().height - targetHeight);
    let current: HTMLElement | null = start;

    while (current && current.tagName !== "BODY" && current.tagName !== "HTML") {
      const h = current.getBoundingClientRect().height;
      // Stop walking up if the element is more than 2× the target height
      if (h > targetHeight * 2) break;
      const delta = Math.abs(h - targetHeight);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = current;
      }
      current = current.parentElement;
    }

    return best;
  }
  // -----------------------------------------------------------------------

  const probe = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!probe) return null;

  const target = findSectionContainer(probe);

  // Outer HTML
  const outerHTML = target.outerHTML;

  // Computed styles — convert camelCase prop names to kebab-case for getPropertyValue
  const computedStyles: Record<string, string> = {};
  const cs = window.getComputedStyle(target);
  for (const prop of props) {
    const kebab = prop.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
    computedStyles[prop] = cs.getPropertyValue(kebab) ?? "";
  }

  // Images: <img> elements
  const images: Array<{ src: string; alt?: string; isBackground: boolean }> = [];
  const imgEls = target.querySelectorAll<HTMLImageElement>("img[src]");
  imgEls.forEach((img) => {
    const src = img.getAttribute("src");
    if (src && !src.startsWith("data:")) {
      images.push({ src, alt: img.alt || undefined, isBackground: false });
    }
  });

  // Images: CSS background-image on any descendant (and self)
  const allEls: HTMLElement[] = [target];
  target.querySelectorAll<HTMLElement>("*").forEach((el) => allEls.push(el));
  for (const el of allEls) {
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none") {
      const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
      if (m && m[1] && !m[1].startsWith("data:")) {
        images.push({ src: m[1], isBackground: true });
      }
    }
  }

  // Text nodes: h1-h6, p, a, button, li
  const textNodes: Array<{ text: string; tag: string; className: string }> = [];
  const textEls = target.querySelectorAll<HTMLElement>(
    "h1,h2,h3,h4,h5,h6,p,a,button,li",
  );
  textEls.forEach((el) => {
    const text = (el.textContent ?? "").trim();
    if (text.length > 0 && text.length < 500) {
      textNodes.push({
        text,
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === "string" ? el.className : "",
      });
    }
  });

  const rect = target.getBoundingClientRect();
  return {
    outerHTML,
    computedStyles,
    images,
    textNodes,
    actualBoundingBox: {
      x: Math.round(rect.left),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}
