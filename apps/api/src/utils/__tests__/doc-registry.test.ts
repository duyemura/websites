import { describe, expect, it } from "vitest";
import { ALLOWED_DOC_KEYS, assertAllowedDocKey } from "../doc-registry";

describe("doc-registry", () => {
  it("includes the new site-hierarchy and section-visual-evidence keys", () => {
    expect(ALLOWED_DOC_KEYS).toContain("site-hierarchy");
    expect(ALLOWED_DOC_KEYS).toContain("section-visual-evidence");
    expect(ALLOWED_DOC_KEYS).not.toContain("blueprint-draft");
  });

  it("accepts the new keys", () => {
    expect(() => assertAllowedDocKey("site-hierarchy")).not.toThrow();
    expect(() => assertAllowedDocKey("section-visual-evidence")).not.toThrow();
  });
});
