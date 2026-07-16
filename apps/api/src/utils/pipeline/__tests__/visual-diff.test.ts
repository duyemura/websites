import { describe, it, expect, vi } from "vitest";
import { visionDiff } from "../visual-diff";

describe("visionDiff", () => {
  it("returns score and issues from a valid JSON response", async () => {
    const chatFn = vi.fn().mockResolvedValue(JSON.stringify({
      score: 72,
      issues: [
        { property: "font-weight", expected: "800", actual: "400", severity: "critical" },
      ],
    }));
    const result = await visionDiff("s3://a", "s3://b", chatFn);
    expect(result.score).toBe(72);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("critical");
  });

  it("returns score 0 and empty issues when JSON is unparseable", async () => {
    const chatFn = vi.fn().mockResolvedValue("not json");
    const result = await visionDiff("s3://a", "s3://b", chatFn);
    expect(result.score).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("extracts JSON embedded in surrounding text", async () => {
    const chatFn = vi.fn().mockResolvedValue('Here is my analysis:\n{"score":90,"issues":[]}');
    const result = await visionDiff("s3://a", "s3://b", chatFn);
    expect(result.score).toBe(90);
  });
});
