import type { Page } from "playwright";
import type { BBox } from "../../types/pipeline-artifacts";

export interface SectionCandidate {
  boundingBox: BBox;
  confidence: number;
  source: "semantic" | "visual-boundary" | "vision";
  innerText: string;
  headingText?: string;
  landmarkTag?: string;    // header/footer/nav — pre-classified structurally
  /** Section type provided directly by the vision model during Rung 3 segmentation.
   *  When present, skip the text-based classifier for this candidate. */
  visionTag?: string;
}

export async function semanticScan(page: Page): Promise<SectionCandidate[]> {
  const raw = await page.evaluate(() => {
    const selectors = [
      "header", "footer", "main > section", "section", "article",
      '[role="banner"]', '[role="contentinfo"]', '[role="main"]',
    ];
    const seen = new Set<Element>();
    const out: Array<{
      rect: { x: number; y: number; width: number; height: number };
      innerText: string; headingText?: string; tag: string;
    }> = [];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (seen.has(el)) continue;
        // skip nested matches (a section inside an already-captured section)
        if ([...seen].some((s) => s.contains(el))) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        out.push({
          rect: { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height },
          innerText: (el as HTMLElement).innerText.slice(0, 500),
          headingText: el.querySelector("h1,h2,h3")?.textContent?.trim() ?? undefined,
          tag: el.tagName.toLowerCase(),
        });
      }
    }
    return out;
  });

  return raw
    .filter((c) => {
      const isLandmark = c.tag === "header" || c.tag === "footer" || c.tag === "nav";
      const minHeight = isLandmark ? 1 : 40;
      return c.rect.height > minHeight && c.rect.width > 100;
    })
    .map((c) => ({
      boundingBox: c.rect,
      confidence: 0.9,
      source: "semantic" as const,
      innerText: c.innerText,
      headingText: c.headingText,
      landmarkTag: c.tag === "header" || c.tag === "footer" || c.tag === "nav" ? c.tag : undefined,
    }));
}

export async function visualBoundaryScan(page: Page): Promise<SectionCandidate[]> {
  const raw = await page.evaluate(() => {
    // Walk direct+nested children of body, collecting large blocks with a resolved background.
    const blocks: Array<{ top: number; bottom: number; bg: string; text: string; heading?: string }> = [];
    const walk = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.height < 80 || r.width < window.innerWidth * 0.5) {
        for (const child of Array.from(el.children)) walk(child);
        return;
      }
      const bg = getComputedStyle(el).backgroundColor;
      const transparent = bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
      if (!transparent) {
        blocks.push({
          top: r.top + window.scrollY,
          bottom: r.bottom + window.scrollY,
          bg,
          text: (el as HTMLElement).innerText.slice(0, 500),
          heading: el.querySelector("h1,h2,h3")?.textContent?.trim() ?? undefined,
        });
        return; // don't descend into a painted band
      }
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(document.body);
    return { blocks, pageWidth: document.documentElement.scrollWidth };
  });

  // Adjacent blocks with different backgrounds = distinct sections.
  const sorted = raw.blocks.sort((a, b) => a.top - b.top);
  const merged: typeof sorted = [];
  for (const block of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && block.bg === prev.bg && block.top - prev.bottom < 40) {
      prev.bottom = Math.max(prev.bottom, block.bottom);
      prev.text += ` ${block.text}`;
    } else {
      merged.push({ ...block });
    }
  }

  return merged.map((b) => ({
    boundingBox: { x: 0, y: b.top, width: raw.pageWidth, height: b.bottom - b.top },
    confidence: 0.6,
    source: "visual-boundary" as const,
    innerText: b.text,
    headingText: b.heading,
  }));
}

export interface LadderResult {
  candidates: SectionCandidate[];
  ladder: { rung1Count: number; rung2Used: boolean; visionUsed: boolean };
}

export async function runLadder(
  page: Page,
  opts: {
    needsVisionSegmentation: boolean;
    visionSegment: () => Promise<SectionCandidate[]>;   // injected — stage wires the real vision call
  },
): Promise<LadderResult> {
  const rung1 = await semanticScan(page);
  let candidates = rung1;
  let rung2Used = false;
  let visionUsed = false;

  if (candidates.length < 3) {
    rung2Used = true;
    const rung2 = await visualBoundaryScan(page);
    candidates = mergeCandidates(candidates, rung2);
  }

  if (candidates.length < 3 || opts.needsVisionSegmentation) {
    visionUsed = true;
    const rung3 = await opts.visionSegment();
    candidates = mergeCandidates(candidates, rung3);
  }

  return {
    candidates: candidates.sort((a, b) => a.boundingBox.y - b.boundingBox.y),
    ladder: { rung1Count: rung1.length, rung2Used, visionUsed },
  };
}

// Higher-confidence candidate wins when vertical overlap > 70%.
export function mergeCandidates(
  primary: SectionCandidate[],
  secondary: SectionCandidate[],
): SectionCandidate[] {
  const result = [...primary];
  for (const cand of secondary) {
    const overlaps = result.some((existing) => verticalOverlap(existing.boundingBox, cand.boundingBox) > 0.7);
    if (!overlaps) result.push(cand);
  }
  return result;
}

function verticalOverlap(a: BBox, b: BBox): number {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, bottom - top);
  return overlap / Math.min(a.height, b.height);
}
