import { describe, test, expect } from "vitest";
import { dedupeFaqs } from "../../src/utils/faqs";

describe("dedupeFaqs", () => {
  test("removes duplicate questions regardless of whitespace or case", () => {
    const faqs = [
      { question: "How do I sign up?", answer: "Fill out the form." },
      { question: "how do i sign up?", answer: "Contact us." },
      { question: "What are your hours?", answer: "6am–10pm." },
      { question: "  How do I sign up?  ", answer: "Visit the front desk." },
    ];
    const result = dedupeFaqs(faqs);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ question: "How do I sign up?", answer: "Fill out the form." });
    expect(result[1]).toEqual({ question: "What are your hours?", answer: "6am–10pm." });
  });

  test("preserves order of first occurrence", () => {
    const faqs = [
      { question: "First?", answer: "A" },
      { question: "Second?", answer: "B" },
      { question: "First?", answer: "C" },
    ];
    const result = dedupeFaqs(faqs);
    expect(result.map((f) => f.answer)).toEqual(["A", "B"]);
  });

  test("returns empty array when given empty input", () => {
    expect(dedupeFaqs([])).toEqual([]);
  });
});
