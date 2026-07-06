import { describe, expect, it } from "vitest";
import { deriveImprovements } from "../improvements";

describe("deriveImprovements", () => {
  const baseline = {
    schemaTypes: [] as string[],
    semanticElementCount: 2,
    axeViolationCount: 23,
    imageBytes: 8_400_000,
    metaDescriptionPages: 3,
    totalPages: 10,
  };
  const clone = {
    schemaTypes: ["LocalBusiness", "FAQPage"],
    semanticElementCount: 14,
    axeViolationCount: 2,
    imageBytes: 1_100_000,
    metaDescriptionPages: 10,
    totalPages: 10,
  };

  it("derives schema, semantics, a11y, weight, and meta improvements from the diff", () => {
    const improvements = deriveImprovements(baseline, clone);
    const categories = improvements.map((i) => i.category);
    expect(categories).toContain("seo");
    expect(categories).toContain("semantics");
    expect(categories).toContain("accessibility");
    expect(categories).toContain("performance");
    expect(improvements.every((i) => i.source === "baseline-diff")).toBe(true);
    const weight = improvements.find((i) => i.description.includes("87%"));
    expect(weight).toBeDefined();
  });

  it("derives nothing when clone does not beat baseline", () => {
    expect(deriveImprovements(baseline, { ...baseline })).toHaveLength(0);
  });
});
