import { describe, it, expect } from "vitest";
import { deriveComponentName, groupSections } from "../section-grouper";
import type { ContractArtifact } from "../../../types/section-contract";
import type { SegmentArtifact } from "../../../types/pipeline-artifacts";

describe("deriveComponentName", () => {
  it("PascalCases the archetype when not unknown", () => {
    expect(deriveComponentName("hero", "hero-left")).toBe("HeroLeft");
    expect(deriveComponentName("cta-band", "cta-band")).toBe("CtaBand");
    expect(deriveComponentName("feature-grid", "feature-grid-bento")).toBe("FeatureGridBento");
  });
  it("falls back to PascalCase tag when archetype is unknown", () => {
    expect(deriveComponentName("header", "unknown")).toBe("Header");
    expect(deriveComponentName("footer", "unknown")).toBe("Footer");
  });
});

const makeSection = (tag: string, archetype: string) => ({
  tag,
  layout: { archetype },
  background: {},
  spacing: { top: "40px", bottom: "40px" },
  typography: {},
  interactions: { accordion: false, scrollSnap: false, stickyPanel: false, hoverEffects: false },
  items: [],
});

const makeSegSection = (tag: string, w: number, h: number, desktop: string, mobile: string) => ({
  id: `s-${desktop}`, tag, order: 0, confidence: 0.9, source: "semantic" as const,
  boundingBox: { x: 0, y: 0, width: w, height: h },
  crops: { desktop, mobile },
  innerText: "", mediaUrls: [], interactionIds: [],
});

const mockContract = {
  pages: [
    { path: "/", sections: [makeSection("hero", "hero-left"), makeSection("cta-band", "cta-band")] },
    { path: "/about", sections: [makeSection("hero", "hero-center"), makeSection("cta-band", "cta-band")] },
  ],
} as unknown as ContractArtifact;

const mockSegment = {
  siteUuid: "test", sourceExtractAt: "", sharedComponents: [],
  pages: [
    { path: "/", ladder: { rung1Count: 2, rung2Used: false, visionUsed: false }, sections: [
      makeSegSection("hero", 1440, 600, "s3://hero-home-d", "s3://hero-home-m"),
      makeSegSection("cta-band", 1440, 200, "s3://cta-d", "s3://cta-m"),
    ]},
    { path: "/about", ladder: { rung1Count: 2, rung2Used: false, visionUsed: false }, sections: [
      makeSegSection("hero", 1440, 800, "s3://hero-about-d", "s3://hero-about-m"),
      makeSegSection("cta-band", 1440, 200, "s3://cta2-d", "s3://cta2-m"),
    ]},
  ],
} as unknown as SegmentArtifact;

describe("groupSections", () => {
  it("creates one group per unique (tag, archetype) pair", () => {
    const groups = groupSections(mockContract, mockSegment);
    expect(groups).toHaveLength(3);
    expect(groups.map(g => g.name)).toEqual(expect.arrayContaining(["HeroLeft", "HeroCenter", "CtaBand"]));
  });
  it("counts occurrences correctly", () => {
    const groups = groupSections(mockContract, mockSegment);
    expect(groups.find(g => g.name === "CtaBand")!.occurrences).toBe(2);
  });
  it("picks exemplar with largest bounding box area", () => {
    const groups = groupSections(mockContract, mockSegment);
    expect(groups.find(g => g.name === "HeroLeft")!.exemplar.cropDesktop).toBe("s3://hero-home-d");
    expect(groups.find(g => g.name === "HeroCenter")!.exemplar.cropDesktop).toBe("s3://hero-about-d");
  });
  it("skips pages with no matching segment page", () => {
    const contractWithExtra = {
      pages: [
        ...mockContract.pages,
        { path: "/missing", sections: [makeSection("hero", "hero-left")] },
      ],
    } as unknown as ContractArtifact;
    // Should not throw — the /missing page has no segment counterpart
    expect(() => groupSections(contractWithExtra, mockSegment)).not.toThrow();
    const groups = groupSections(contractWithExtra, mockSegment);
    // Still only 3 groups (the /missing page is skipped)
    expect(groups).toHaveLength(3);
  });
  it("handles empty pages array", () => {
    const empty = { pages: [] } as unknown as ContractArtifact;
    const emptySegment = { ...mockSegment, pages: [] } as unknown as SegmentArtifact;
    expect(groupSections(empty, emptySegment)).toEqual([]);
  });
});
