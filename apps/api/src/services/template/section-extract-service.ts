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
  cssRules: string[];
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

  // Intercept all CSS responses before the page loads.
  // This is necessary because cross-origin stylesheets (CDN, frameworks, etc.)
  // throw a CORS security error when accessed via document.styleSheets in the
  // browser. By capturing their content here (in Node.js, where CORS doesn't
  // apply) and re-injecting as inline <style> tags after load, we make ALL
  // CSS same-origin and accessible for rule extraction. This approach is
  // completely source-site-agnostic — it works for any framework or CDN.
  const capturedCSS: string[] = [];
  await page.route(/\.css(\?.*)?$/, async (route) => {
    try {
      const response = await route.fetch();
      const text = await response.text();
      if (text.trim().length > 0) capturedCSS.push(text);
      await route.fulfill({ response });
    } catch {
      await route.continue();
    }
  });

  try {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 900 });
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60_000 });

    // Inject all captured CSS as inline <style> tags so they become same-origin
    // and accessible via document.styleSheets for rule matching below.
    // We inject AFTER load so inline styles don't conflict with the page's own
    // cascade during rendering.
    for (const css of capturedCSS) {
      try {
        await page.addStyleTag({ content: css });
      } catch { /* ignore parse errors in individual sheets */ }
    }

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

        // Pass the function as a string to avoid TypeScript/esbuild injecting
        // __name() helpers that don't exist in the browser context.
        const evalArgs = JSON.stringify({
          x: centerX,
          y: vpY,
          targetHeight: bbox.height,
          props: [...COMPUTED_STYLE_PROPS],
          maxOuterHTMLBytes: MAX_OUTER_HTML_BYTES,
        });
        extraction = await page.evaluate(
          `(${DOM_EXTRACT_FN_JS})(${evalArgs})`,
        ) as DomExtractionResult | null;
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
        cssRules: extraction.cssRules,
        boundingBox: extraction.actualBoundingBox,
      });
    }

    return results;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Browser-side extraction function written as a raw JS string.
//
// IMPORTANT: This MUST be a plain JavaScript string, NOT a TypeScript function
// reference. When TypeScript/esbuild compiles named function declarations it
// injects a `__name()` helper at module scope. If you pass the compiled
// function reference to page.evaluate(), Playwright serialises its body which
// contains `__name(findSectionContainer, "findSectionContainer")` — a
// reference that does not exist in the browser page context, causing:
//   ReferenceError: __name is not defined
//
// Passing a raw string bypasses all TypeScript compilation and runs verbatim
// in the browser with no external dependencies.
// ---------------------------------------------------------------------------

const DOM_EXTRACT_FN_JS = /* js */ `(args) => {
  const { x, y, targetHeight, props, maxOuterHTMLBytes } = args;

  // Walk up the DOM from elementFromPoint to find the section-level container
  // whose height is closest to targetHeight (reject anything > 2× target).
  const findSectionContainer = (start) => {
    let best = start;
    let bestDelta = Math.abs(start.getBoundingClientRect().height - targetHeight);
    let current = start;
    while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML') {
      const h = current.getBoundingClientRect().height;
      if (h > targetHeight * 2) break;
      const delta = Math.abs(h - targetHeight);
      if (delta < bestDelta) { bestDelta = delta; best = current; }
      current = current.parentElement;
    }
    return best;
  };

  const probe = document.elementFromPoint(x, y);
  if (!probe) return null;

  const target = findSectionContainer(probe);

  // Outer HTML (truncated)
  let outerHTML = target.outerHTML;
  if (outerHTML.length > maxOuterHTMLBytes) {
    outerHTML = outerHTML.slice(0, maxOuterHTMLBytes) + '<!-- truncated -->';
  }

  // Computed styles
  const computedStyles = {};
  const cs = window.getComputedStyle(target);
  for (const prop of props) {
    const kebab = prop.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
    computedStyles[prop] = cs.getPropertyValue(kebab) || '';
  }

  // Images: <img src> elements
  const images = [];
  target.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && !src.startsWith('data:')) {
      images.push({ src, alt: img.alt || undefined, isBackground: false });
    }
  });

  // Images: CSS background-image on self and descendants
  const allEls = [target, ...target.querySelectorAll('*')];
  for (const el of allEls) {
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const m = /url\\(["']?([^"')]+)["']?\\)/.exec(bg);
      if (m && m[1] && !m[1].startsWith('data:')) {
        images.push({ src: m[1], isBackground: true });
      }
    }
  }

  // Text nodes: heading, paragraph, interactive elements
  const textNodes = [];
  target.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li').forEach((el) => {
    const text = (el.textContent || '').trim();
    if (text.length > 0 && text.length < 500) {
      textNodes.push({
        text,
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === 'string' ? el.className : '',
      });
    }
  });

  // CSS rule extraction — generic, works for any source site.
  //
  // Because we injected all external stylesheets as inline <style> tags before
  // calling this function, document.styleSheets now contains ALL rules including
  // those from CDN-hosted frameworks, without CORS restrictions.
  //
  // We walk every rule in every sheet and keep only those whose selector
  // matches at least one element inside this section (or the section itself).
  // @media and @supports rules are recursively checked. @font-face and
  // @keyframes are kept unconditionally (they're referenced by matched rules).
  const cssRules = [];
  const seen = new Set();

  const extractRulesFromList = (ruleList) => {
    for (const rule of ruleList) {
      const text = rule.cssText;
      if (seen.has(text)) continue;

      if (rule.type === 1 /* CSSStyleRule */) {
        let matches = false;
        try {
          matches = target.matches(rule.selectorText) ||
                    !!target.querySelector(rule.selectorText);
        } catch (e) { /* invalid selector — skip */ }
        if (matches) { seen.add(text); cssRules.push(text); }

      } else if (rule.type === 4 /* CSSMediaRule */ ||
                 rule.type === 12 /* CSSSupportsRule */) {
        const innerMatched = [];
        for (const inner of rule.cssRules || []) {
          if (inner.type !== 1) continue;
          let m = false;
          try {
            m = target.matches(inner.selectorText) ||
                !!target.querySelector(inner.selectorText);
          } catch (e) { /* skip */ }
          if (m && !seen.has(inner.cssText)) {
            seen.add(inner.cssText);
            innerMatched.push(inner.cssText);
          }
        }
        if (innerMatched.length > 0) {
          const wrapped = rule.type === 4
            ? '@media ' + rule.conditionText + ' { ' + innerMatched.join(' ') + ' }'
            : '@supports ' + rule.conditionText + ' { ' + innerMatched.join(' ') + ' }';
          if (!seen.has(wrapped)) { seen.add(wrapped); cssRules.push(wrapped); }
        }

      } else if (rule.type === 5  /* CSSFontFaceRule */ ||
                 rule.type === 7  /* CSSKeyframesRule */) {
        // Always include — may be referenced by matched style rules
        if (!seen.has(text)) { seen.add(text); cssRules.push(text); }
      }
    }
  };

  for (const sheet of document.styleSheets) {
    try {
      extractRulesFromList(sheet.cssRules);
    } catch (e) {
      // Still cross-origin (e.g. data: URL sheet) — skip silently
    }
  }

  const rect = target.getBoundingClientRect();
  return {
    outerHTML,
    computedStyles,
    images,
    textNodes,
    cssRules,
    actualBoundingBox: {
      x: Math.round(rect.left),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}`;
