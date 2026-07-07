import { describe, test, expect } from "vitest";
import { dedupeWarnings, estimateMirrorCosts } from "../types";

// ── dedupeWarnings ────────────────────────────────────────────────────────────
// When 800 pages each emit the same warning, the report should say
// "Webflow plugin detected (800 pages)" not list 800 lines.

describe("dedupeWarnings", () => {
  test("unique warnings pass through unchanged", () => {
    const w = ["address not found", "phone not found", "logo missing"];
    expect(dedupeWarnings(w)).toEqual(w);
  });

  test("repeated warnings are grouped with count", () => {
    const w = [
      "/page1: Elementor detected",
      "/page2: Elementor detected",
      "/page3: Elementor detected",
    ];
    const result = dedupeWarnings(w);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Elementor detected (3 pages)");
  });

  test("single occurrence of a message is not suffixed with count", () => {
    const w = ["/page1: Something unusual"];
    const result = dedupeWarnings(w);
    expect(result[0]).toBe("Something unusual");
    expect(result[0]).not.toContain("(1");
  });

  test("mixed unique and repeated warnings", () => {
    const w = [
      "/home: Webflow plugin",
      "/about: Webflow plugin",
      "/contact: booking widget found",
    ];
    const result = dedupeWarnings(w);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.includes("Webflow"))).toBe("Webflow plugin (2 pages)");
    expect(result.find((r) => r.includes("booking"))).toBe("booking widget found");
  });

  test("empty array returns empty array", () => {
    expect(dedupeWarnings([])).toEqual([]);
  });

  test("warnings without path prefix are deduplicated by full message", () => {
    const w = ["design-system doc missing", "design-system doc missing"];
    const result = dedupeWarnings(w);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("design-system doc missing (2 pages)");
  });

  test("real-world: 20 Webflow pages collapse to one warning", () => {
    const w = Array.from({ length: 20 }, (_, i) => `/page-${i}: dynamic plugin (Webflow)`);
    const result = dedupeWarnings(w);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("dynamic plugin (Webflow) (20 pages)");
  });
});

// ── estimateMirrorCosts ───────────────────────────────────────────────────────
// Rough cost estimates shown in the pipeline report.
// Tests verify the math is reasonable, not precise — rates can change.

describe("estimateMirrorCosts", () => {
  test("returns all required cost fields", () => {
    const costs = estimateMirrorCosts(20, 200);
    expect(costs).toHaveProperty("s3Puts");
    expect(costs).toHaveProperty("s3Gets");
    expect(costs).toHaveProperty("s3BytesUploaded");
    expect(costs).toHaveProperty("estimatedUsd");
    expect(costs).toHaveProperty("monthlyStorageUsd");
  });

  test("more pages and assets = higher cost", () => {
    const small = estimateMirrorCosts(5, 50);
    const large = estimateMirrorCosts(50, 500);
    expect(large.s3Puts).toBeGreaterThan(small.s3Puts);
    expect(large.s3BytesUploaded).toBeGreaterThan(small.s3BytesUploaded);
    expect(large.estimatedUsd).toBeGreaterThan(small.estimatedUsd);
    expect(large.monthlyStorageUsd).toBeGreaterThan(small.monthlyStorageUsd);
  });

  test("free tier (20 pages, ~200 assets) costs under $0.01 one-time", () => {
    const costs = estimateMirrorCosts(20, 200);
    expect(costs.estimatedUsd).toBeLessThan(0.01);
  });

  test("zero pages and assets produces zero or near-zero costs", () => {
    const costs = estimateMirrorCosts(0, 0);
    expect(costs.s3Puts).toBe(0);
    expect(costs.s3Gets).toBe(0);
    expect(costs.s3BytesUploaded).toBe(0);
    expect(costs.estimatedUsd).toBe(0);
    expect(costs.monthlyStorageUsd).toBe(0);
  });

  test("s3Gets equals page count (one GET per page to read snapshot HTML)", () => {
    expect(estimateMirrorCosts(10, 100).s3Gets).toBe(10);
    expect(estimateMirrorCosts(20, 200).s3Gets).toBe(20);
  });
});
