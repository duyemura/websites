import { describe, expect, it } from "vitest";
import {
  computeSectionDiff,
  inferBackgroundClass,
  rgbToHex,
} from "../section-diff";
import type { ExtractedSection } from "../section-diff";

describe("section-diff", () => {
  describe("rgbToHex", () => {
    it("converts rgb triples to hex", () => {
      expect(rgbToHex("rgb(37, 99, 255)")).toBe("#2563ff");
      expect(rgbToHex("rgba(0, 0, 0, 0.9)")).toBe("#000000");
    });

    it("returns undefined for invalid inputs", () => {
      expect(rgbToHex("transparent")).toBeUndefined();
      expect(rgbToHex("")).toBeUndefined();
    });
  });

  describe("inferBackgroundClass", () => {
    it("classifies the Beta Gym accent blue", () => {
      expect(inferBackgroundClass("rgb(37, 99, 255)")).toBe("accent");
      expect(inferBackgroundClass("rgb(0, 99, 255)")).toBe("accent");
    });

    it("classifies black as dark", () => {
      expect(inferBackgroundClass("rgb(0, 0, 0)")).toBe("dark");
    });

    it("classifies transparent as transparent", () => {
      expect(inferBackgroundClass("rgba(0, 0, 0, 0)")).toBe("transparent");
    });
  });

  describe("computeSectionDiff", () => {
    const box = { x: 0, y: 0, width: 1200, height: 600 };

    function makeSection(
      background: string,
      items: ExtractedSection["items"],
    ): ExtractedSection {
      return { backgroundColor: background, items };
    }

    it("returns all-match when source and rendered are identical", () => {
      const source = makeSection("rgb(0, 0, 0)", [
        { title: "A", background: "rgb(37, 99, 255)", hasIcon: true, col: 1, row: 1, width: 1, height: 1 },
        { title: "B", background: "rgb(0, 0, 0)", hasIcon: true, col: 2, row: 1, width: 1, height: 1 },
        { title: "C", background: "rgb(37, 99, 255)", hasIcon: true, col: 3, row: 1, width: 1, height: 1 },
        { title: "D", background: "rgb(0, 0, 0)", hasIcon: true, col: 1, row: 2, width: 1, height: 1 },
        { title: "E", background: "rgb(37, 99, 255)", hasIcon: true, col: 2, row: 2, width: 1, height: 1 },
        { title: "F", background: "rgb(0, 0, 0)", hasIcon: true, col: 3, row: 2, width: 1, height: 1 },
      ]);
      const report = computeSectionDiff("Heading", "Heading", box, box, source, source);
      expect(report.diffs.every((d) => d.status === "match")).toBe(true);
      expect(report.sourceItems).toHaveLength(6);
    });

    it("flags high-risk when item count differs", () => {
      const source = makeSection("rgb(0, 0, 0)", [
        { title: "A", background: "rgb(37, 99, 255)", hasIcon: true, col: 1, row: 1, width: 1, height: 1 },
      ]);
      const rendered = makeSection("rgb(0, 0, 0)", []);
      const report = computeSectionDiff("Heading", "Heading", box, box, source, rendered);
      const itemCount = report.diffs.find((d) => d.field === "item count");
      expect(itemCount?.status).toBe("mismatch-high");
    });

    it("uses SECTION_DIFF_THRESHOLD to relax accent tile matching", () => {
      const source = makeSection("rgb(0, 0, 0)", [
        { title: "A", background: "rgb(37, 99, 255)", hasIcon: true, col: 1, row: 1, width: 1, height: 1 },
        { title: "B", background: "rgb(0, 0, 0)", hasIcon: true, col: 2, row: 1, width: 1, height: 1 },
        { title: "C", background: "rgb(37, 99, 255)", hasIcon: true, col: 1, row: 2, width: 1, height: 1 },
        { title: "D", background: "rgb(0, 0, 0)", hasIcon: true, col: 2, row: 2, width: 1, height: 1 },
      ]);
      const rendered = makeSection("rgb(0, 0, 0)", [
        { title: "A", background: "rgb(37, 99, 255)", hasIcon: true, col: 1, row: 1, width: 1, height: 1 },
        { title: "B", background: "rgb(0, 0, 0)", hasIcon: true, col: 2, row: 1, width: 1, height: 1 },
        { title: "C", background: "rgb(0, 0, 0)", hasIcon: true, col: 1, row: 2, width: 1, height: 1 },
        { title: "D", background: "rgb(0, 0, 0)", hasIcon: true, col: 2, row: 2, width: 1, height: 1 },
      ]);
      const strict = computeSectionDiff("Heading", "Heading", box, box, source, rendered);
      expect(strict.diffs.find((d) => d.field === "accent tile count")?.status).toBe("mismatch-low");

      const relaxed = computeSectionDiff("Heading", "Heading", box, box, source, rendered, 0.5);
      expect(relaxed.diffs.find((d) => d.field === "accent tile count")?.status).toBe("match");
    });

    it("flags low-risk when icon counts differ", () => {
      const source = makeSection("rgb(0, 0, 0)", [
        { title: "A", background: "rgb(0, 0, 0)", hasIcon: true, col: 1, row: 1, width: 1, height: 1 },
        { title: "B", background: "rgb(0, 0, 0)", hasIcon: true, col: 2, row: 1, width: 1, height: 1 },
      ]);
      const rendered = makeSection("rgb(0, 0, 0)", [
        { title: "A", background: "rgb(0, 0, 0)", hasIcon: true, col: 1, row: 1, width: 1, height: 1 },
        { title: "B", background: "rgb(0, 0, 0)", hasIcon: false, col: 2, row: 1, width: 1, height: 1 },
      ]);
      const report = computeSectionDiff("Heading", "Heading", box, box, source, rendered);
      expect(report.diffs.find((d) => d.field === "icon presence")?.status).toBe("mismatch-low");
    });
  });
});
