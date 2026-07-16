import type { ContractArtifact, SectionContract } from "../../types/section-contract";
import type { SegmentArtifact, CanonicalSectionTag } from "../../types/pipeline-artifacts";

export interface ComponentGroup {
  name: string;
  tag: CanonicalSectionTag;
  archetype: string;
  exemplar: {
    page: string;
    contract: SectionContract;
    cropDesktop: string;
    cropMobile: string;
    area: number;
  };
  occurrences: number;
}

export function deriveComponentName(tag: string, archetype: string): string {
  const key = archetype === "unknown" ? tag : archetype;
  return key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

export function groupSections(
  contract: ContractArtifact,
  segment: SegmentArtifact,
): ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>();

  for (const contractPage of contract.pages) {
    const segPage = segment.pages.find((p) => p.path === contractPage.path);
    if (!segPage) continue;

    for (let i = 0; i < contractPage.sections.length; i++) {
      const section = contractPage.sections[i];
      const segSection = segPage.sections[i];
      if (!segSection) continue;

      const archetype: string = (section.layout as { archetype?: string })?.archetype ?? "unknown";
      const key = `${section.tag}::${archetype}`;
      const area = segSection.boundingBox.width * segSection.boundingBox.height;
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          name: deriveComponentName(section.tag, archetype),
          tag: section.tag,
          archetype,
          exemplar: {
            page: contractPage.path,
            contract: section,
            cropDesktop: segSection.crops.desktop,
            cropMobile: segSection.crops.mobile,
            area,
          },
          occurrences: 1,
        });
      } else {
        existing.occurrences++;
        if (area > existing.exemplar.area) {
          existing.exemplar = {
            page: contractPage.path,
            contract: section,
            cropDesktop: segSection.crops.desktop,
            cropMobile: segSection.crops.mobile,
            area,
          };
        }
      }
    }
  }

  return Array.from(groups.values());
}
