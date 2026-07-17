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
    expect(result.failed).toBeFalsy();
  });

  it("returns score 0 and empty issues when JSON is unparseable, with failed: true", async () => {
    const chatFn = vi.fn().mockResolvedValue("not json");
    const result = await visionDiff("s3://a", "s3://b", chatFn);
    expect(result.score).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.failed).toBe(true);
  });

  it("extracts JSON embedded in surrounding text", async () => {
    const chatFn = vi.fn().mockResolvedValue('Here is my analysis:\n{"score":90,"issues":[]}');
    const result = await visionDiff("s3://a", "s3://b", chatFn);
    expect(result.score).toBe(90);
    expect(result.failed).toBeFalsy();
  });

  it("returns failed: true when loadImageFn throws", async () => {
    const chatFn = vi.fn().mockResolvedValue('{"score":80,"issues":[]}');
    const loadImageFn = vi.fn().mockRejectedValue(new Error("S3 fetch failed"));
    const result = await visionDiff("s3://a", "data:image/png;base64,abc", chatFn, loadImageFn);
    expect(result.score).toBe(0);
    expect(result.issues).toEqual([]);
    expect(result.failed).toBe(true);
  });

  it("does not set failed when no loadImageFn is provided (intentional no-image path)", async () => {
    const chatFn = vi.fn().mockResolvedValue('{"score":55,"issues":[]}');
    const result = await visionDiff("s3://a", "s3://b", chatFn);
    // No loadImageFn — chatFn still runs with just the text prompt
    expect(result.score).toBe(55);
    expect(result.failed).toBeFalsy();
  });
});
