import type { ScrapedWebsiteData } from "./scrape-docs";
import type {
  SectionVisualEvidence,
  SectionVisualEvidenceRow,
  InteractionEvidenceCapture,
} from "../types/section-visual-evidence";
import type {
  ExtractArtifact,
  ExtractPage,
  SegmentArtifact,
} from "../types/pipeline-artifacts";
import { pathToSlug } from "./site-hierarchy-builder";

export function buildSectionVisualEvidence(
  data: ScrapedWebsiteData,
): SectionVisualEvidence {
  return {
    version: "1",
    rows: data.sections?.map((s) => s.visualEvidence) ?? [],
  };
}

export function buildSectionVisualEvidenceFromSegments(
  segment: SegmentArtifact,
  extract: ExtractArtifact,
): SectionVisualEvidence {
  const extractPageByPath = new Map<string, ExtractPage>();
  for (const p of extract.pages) extractPageByPath.set(p.path, p);

  const rows: SectionVisualEvidenceRow[] = [];

  for (const sp of segment.pages) {
    const pageSlug = pathToSlug(sp.path);
    const ep = extractPageByPath.get(sp.path);
    const interactionsById = new Map(
      (ep?.interactions ?? []).map((i) => [i.id, i]),
    );

    for (const section of sp.sections) {
      const interactionCaptures: InteractionEvidenceCapture[] =
        section.interactionIds
          .map((id) => interactionsById.get(id))
          .filter((i): i is NonNullable<typeof i> => Boolean(i))
          .map((i) => ({
            id: i.id,
            trigger: i.trigger,
            triggerSelector: i.selector,
            beforeUrl: i.beforeUrl,
            afterUrl: i.afterUrl,
            styleDiff: i.styleDiff,
            componentPattern: undefined,
          }));

      rows.push({
        evidenceId: section.id,
        pageSlug,
        sectionId: section.id,
        screenshotUrl: section.crops.desktop,
        mobileScreenshotUrl: section.crops.mobile,
        boundingBox: section.boundingBox,
        computedStyles: [],
        mediaUrls: section.mediaUrls.length > 0 ? section.mediaUrls : undefined,
        interactionCaptures:
          interactionCaptures.length > 0 ? interactionCaptures : undefined,
      });
    }
  }

  return { version: "1", rows };
}
