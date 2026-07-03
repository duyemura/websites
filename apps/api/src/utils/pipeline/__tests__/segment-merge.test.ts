import { describe, expect, it } from "vitest";
import { fillGaps } from "../segment-merge";

describe("fillGaps", () => {
  const section = (y: number, height: number) => ({
    boundingBox: { x: 0, y, width: 1440, height },
    confidence: 0.9,
    source: "semantic" as const,
    innerText: "x",
  });

  it("inserts unknown sections for uncovered spans > 200px", () => {
    const result = fillGaps([section(0, 100), section(600, 200)], 1000, 1440);
    // gap 100..600 (500px) and 800..1000 (200px — NOT > 200, excluded)
    const unknowns = result.filter((s) => s.source === "gap-fill");
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0].boundingBox.y).toBe(100);
    expect(unknowns[0].boundingBox.height).toBe(500);
  });

  it("returns sections ordered top to bottom with order indexes", () => {
    const result = fillGaps([section(600, 200), section(0, 100)], 800, 1440);
    expect(result.map((s) => s.boundingBox.y)).toEqual([0, 100, 600]);
  });
});
