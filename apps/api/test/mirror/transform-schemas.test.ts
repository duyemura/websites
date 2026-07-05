import { describe, it, expect } from "vitest";
import { CreateTransformSchema } from "../../src/utils/mirror/transform-schemas";

describe("CreateTransformSchema (edit clamp)", () => {
  it("accepts a valid meta-set", () => {
    const r = CreateTransformSchema.safeParse({
      type: "meta-set",
      pageGlob: "/",
      payload: { title: "New Title" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts attr-set with selector", () => {
    const r = CreateTransformSchema.safeParse({
      type: "attr-set",
      pageGlob: "/*",
      selector: "img.hero",
      payload: { attr: "alt", value: "Gym" },
    });
    expect(r.success).toBe(true);
  });

  it("REJECTS free-form html insertion type (the clamp)", () => {
    const r = CreateTransformSchema.safeParse({
      type: "html-insert",
      pageGlob: "/",
      payload: { html: "<section>new section</section>" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects attr-set without a selector", () => {
    const r = CreateTransformSchema.safeParse({
      type: "attr-set",
      pageGlob: "/",
      payload: { attr: "alt", value: "x" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects text-replace with mismatched payload", () => {
    const r = CreateTransformSchema.safeParse({
      type: "text-replace",
      pageGlob: "/",
      selector: "h1",
      payload: { html: "<h1>replaced</h1>" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts jsonld-inject with a json object payload", () => {
    const r = CreateTransformSchema.safeParse({
      type: "jsonld-inject",
      pageGlob: "/*",
      payload: { json: { "@type": "LocalBusiness", name: "Gym" } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts head-inject with an html string payload", () => {
    const r = CreateTransformSchema.safeParse({
      type: "head-inject",
      pageGlob: "/*",
      payload: { html: "<script>analytics()</script>" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts page-replace with an artifactRef payload", () => {
    const r = CreateTransformSchema.safeParse({
      type: "page-replace",
      pageGlob: "/coaches",
      payload: { artifactRef: "sites/abc/artifacts/coaches-v2.html" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts meta-set with name+content instead of title", () => {
    const r = CreateTransformSchema.safeParse({
      type: "meta-set",
      pageGlob: "/",
      payload: { name: "description", content: "The best gym in LA" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects meta-set with neither title nor name/property", () => {
    const r = CreateTransformSchema.safeParse({
      type: "meta-set",
      pageGlob: "/",
      payload: {},
    });
    expect(r.success).toBe(false);
  });

  it("author defaults to human when omitted", () => {
    const r = CreateTransformSchema.safeParse({
      type: "meta-set",
      pageGlob: "/",
      payload: { title: "x" },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.author).toBe("human");
  });

  it("accepts author: agent for AI-authored transforms", () => {
    const r = CreateTransformSchema.safeParse({
      type: "attr-set",
      pageGlob: "/*",
      selector: "img",
      payload: { attr: "alt", value: "Gym interior" },
      author: "agent",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.author).toBe("agent");
  });
});
