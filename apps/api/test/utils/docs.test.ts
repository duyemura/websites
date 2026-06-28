import { describe, test, expect } from "vitest";
import { makeDocKey } from "../../src/utils/docs";

describe("makeDocKey", () => {
  test("generates a kebab key from a title", () => {
    expect(makeDocKey("Gym story")).toBe("gym-story");
  });

  test("strips leading and trailing separators", () => {
    expect(makeDocKey("--Our Story--")).toBe("our-story");
  });

  test("collapses non-alphanumeric characters", () => {
    expect(makeDocKey("Classes & Schedule!!!")).toBe("classes-schedule");
  });

  test("uses a provided key when given", () => {
    expect(makeDocKey("Any title", "My Custom Key")).toBe("my-custom-key");
  });

  test("lowercases a provided key", () => {
    expect(makeDocKey("Any title", "FAQ")).toBe("faq");
  });

  test("returns an empty string for an empty title", () => {
    expect(makeDocKey("")).toBe("");
  });

  test("returns an empty string when only separators remain", () => {
    expect(makeDocKey("!!!")).toBe("");
  });
});
