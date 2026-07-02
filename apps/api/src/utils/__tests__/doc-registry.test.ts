import { describe, expect, it } from "vitest";
import { ALLOWED_DOC_KEYS, assertAllowedDocKey } from "../doc-registry";

describe("doc-registry", () => {
  it("includes the new site-hierarchy and section-visual-evidence keys", () => {
    expect(ALLOWED_DOC_KEYS).toContain("site-hierarchy");
    expect(ALLOWED_DOC_KEYS).toContain("section-visual-evidence");
  });

  it("accepts the new keys", () => {
    expect(() => assertAllowedDocKey("site-hierarchy")).not.toThrow();
    expect(() => assertAllowedDocKey("section-visual-evidence")).not.toThrow();
  });

  it("still accepts blueprint-draft while site-docs emits it", () => {
    expect(ALLOWED_DOC_KEYS).toContain("blueprint-draft");
    expect(() => assertAllowedDocKey("blueprint-draft")).not.toThrow();
  });
});
