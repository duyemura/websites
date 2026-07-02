import type { ScrapedWebsiteData } from "./scrape-docs";
import type { SectionVisualEvidence } from "../types/section-visual-evidence";

export function buildSectionVisualEvidence(
  data: ScrapedWebsiteData,
): SectionVisualEvidence {
  return {
    version: "1",
    rows: data.sections?.map((s) => s.visualEvidence) ?? [],
  };
}
