import { describe, test, expect } from "vitest";
import { sanitizeJsonValue } from "../sanitize-json";

describe("sanitizeJsonValue", () => {
  test("removes null bytes", () => {
    expect(sanitizeJsonValue("a\0b")).toBe("ab");
  });

  test("preserves valid surrogate pairs and replaces lone surrogates", () => {
    // Valid pair followed by lone high surrogate.
    const input = "😀\uD83D";
    expect(sanitizeJsonValue(input)).toBe(`😀�`);
  });

  test("replaces lone low surrogate", () => {
    expect(sanitizeJsonValue("\uDE00")).toBe(`�`);
  });

  test("processes nested objects and arrays", () => {
    expect(sanitizeJsonValue({ text: `hello😀\uD83D` })).toEqual({
      text: `hello😀�`,
    });
  });
});
