import { describe, expect, it, vi } from "vitest";
import { classifySections } from "../section-classifier";

describe("classifySections", () => {
  it("classifies sections in one batched call and skips landmark-tagged ones", async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify([
        { index: 0, tag: "hero" },
        { index: 1, tag: "feature-grid" },
        { index: 2, tag: "testimonial-band" },
      ]),
    });
    const sections = [
      { headingText: "Train Harder", innerText: "The best gym in town Join now" },
      { headingText: "Our classes", innerText: "CrossFit, Yoga, HIIT" },
      { headingText: undefined, innerText: '"Best gym ever" — Member' },
      { landmarkTag: "header", headingText: undefined, innerText: "Home About" },
    ];
    const tags = await classifySections(sections, chat);
    expect(tags).toEqual(["hero", "feature-grid", "testimonial-band", "header"]);
    expect(chat).toHaveBeenCalledTimes(1);                       // one batched call
    expect(chat.mock.calls[0][0].messages[0].content).not.toContain("Home About"); // landmark skipped
  });

  it("falls back to unknown on unparseable LLM output", async () => {
    const chat = vi.fn().mockResolvedValue({ content: "not json" });
    const tags = await classifySections([{ headingText: "X", innerText: "y" }], chat);
    expect(tags).toEqual(["unknown"]);
  });
});
