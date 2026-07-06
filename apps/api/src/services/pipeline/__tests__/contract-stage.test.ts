import { describe, expect, it } from "vitest";
import { inferArchetype, inferItemBackground } from "../contract-stage";
import type { SegmentSection } from "../../../types/pipeline-artifacts";

describe("contract-stage", () => {
  describe("inferArchetype", () => {
    function section(tag: SegmentSection["tag"]): SegmentSection {
      return {
        id: "s1",
        tag,
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        confidence: 0.9,
        domStyles: {},
        content: { heading: "", body: "" },
        mediaUrls: [],
      };
    }

    it("classifies hero rows as hero-center by default", () => {
      expect(inferArchetype(section("hero"), {})).toBe("hero-center");
    });

    it("classifies hero rows with right alignment as hero-right", () => {
      expect(inferArchetype(section("hero"), { flexDirection: "row", textAlign: "right" })).toBe("hero-right");
    });

    it("classifies feature-grid sections", () => {
      expect(inferArchetype(section("feature-grid"), {})).toBe("feature-grid-even");
    });

    it("classifies FAQ sections as accordion", () => {
      expect(inferArchetype(section("faq-block"), {})).toBe("faq-accordion");
    });
  });

  describe("inferItemBackground", () => {
    it("maps Beta Gym accent blue", () => {
      expect(inferItemBackground("rgb(37, 99, 255)")).toBe("accent");
    });

    it("maps black to dark", () => {
      expect(inferItemBackground("rgb(0, 0, 0)")).toBe("dark");
    });

    it("maps transparent to transparent", () => {
      expect(inferItemBackground("rgba(0, 0, 0, 0)")).toBe("transparent");
    });
  });
});
