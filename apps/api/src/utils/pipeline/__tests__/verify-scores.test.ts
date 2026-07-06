import { describe, expect, it } from "vitest";
import { computeScores } from "../verify-checks";

const check = (critical: boolean) => ({ id: "c", label: "c", critical });

describe("computeScores", () => {
  it("caps master fidelity at 79 when a critical mechanical check fails", () => {
    const scores = computeScores({
      passed: Array(9).fill(check(false)),
      failed: [check(true)],
      visionScores: [95, 93],
    });
    expect(scores.masterFidelity).toBeLessThanOrEqual(79);
  });

  it("blends mechanical and visual 50/50 with no critical failures", () => {
    const scores = computeScores({
      passed: Array(8).fill(check(false)),
      failed: [check(false), check(false)], // 80% mechanical
      visionScores: [90, 90], // 90 visual
    });
    expect(scores.mechanicalFidelity).toBe(80);
    expect(scores.visualFidelity).toBe(90);
    expect(scores.masterFidelity).toBe(85);
  });

  it("handles empty check lists as zero mechanical fidelity", () => {
    const scores = computeScores({
      passed: [],
      failed: [],
      visionScores: [90],
    });
    expect(scores.mechanicalFidelity).toBe(0);
    expect(scores.visualFidelity).toBe(90);
  });

  it("handles empty vision scores as zero visual fidelity", () => {
    const scores = computeScores({
      passed: [check(false), check(false)],
      failed: [],
      visionScores: [],
    });
    expect(scores.mechanicalFidelity).toBe(100);
    expect(scores.visualFidelity).toBe(0);
  });
});
