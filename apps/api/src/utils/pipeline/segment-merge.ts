import type { SectionCandidate } from "./segment-ladder";

export interface GapFilledCandidate extends Omit<SectionCandidate, "source"> {
  source: SectionCandidate["source"] | "gap-fill";
}

const MIN_GAP_PX = 200;

export function fillGaps(
  candidates: SectionCandidate[],
  pageHeight: number,
  pageWidth: number,
): GapFilledCandidate[] {
  const sorted: GapFilledCandidate[] = [...candidates].sort((a, b) => a.boundingBox.y - b.boundingBox.y);
  const result: GapFilledCandidate[] = [];
  let cursor = 0;

  for (const cand of sorted) {
    const gap = cand.boundingBox.y - cursor;
    if (gap > MIN_GAP_PX) {
      result.push({
        boundingBox: { x: 0, y: cursor, width: pageWidth, height: gap },
        confidence: 0.3,
        source: "gap-fill",
        innerText: "",
      });
    }
    result.push(cand);
    cursor = Math.max(cursor, cand.boundingBox.y + cand.boundingBox.height);
  }
  if (pageHeight - cursor > MIN_GAP_PX) {
    result.push({
      boundingBox: { x: 0, y: cursor, width: pageWidth, height: pageHeight - cursor },
      confidence: 0.3,
      source: "gap-fill",
      innerText: "",
    });
  }
  return result;
}
