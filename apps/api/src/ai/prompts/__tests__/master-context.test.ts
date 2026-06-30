import { describe, test, expect } from "vitest";
import { assembleMasterContext } from "../master-context";
import type { Doc } from "@ploy-gyms/shared-types";

function makeDoc(key: string, title: string, content: string): Doc {
  return {
    uuid: `doc-${key}`,
    workspaceUuid: "ws-1",
    key,
    title,
    content,
    source: "ai_extracted",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("assembleMasterContext", () => {
  test("requires a job or includeKeys", () => {
    const docs = [makeDoc("workspace-memory", "Workspace memory", "Business: Beta Gym")];
    const ctx = assembleMasterContext(docs);
    expect(ctx.warnings.length).toBeGreaterThan(0);
    expect(ctx.includedKeys).toEqual([]);
  });

  test("includes workspace and site memory first for website generation", () => {
    const docs = [
      makeDoc("workspace-memory", "Workspace memory", "Business: Beta Gym"),
      makeDoc("site-memory", "Site memory", "Source: example.com"),
      makeDoc("brand-guidelines", "Brand guidelines", "Accent: #ff4d00"),
      makeDoc("business-info", "Business info", "Phone: 555-1234"),
    ];
    const ctx = assembleMasterContext(docs, { job: "website-generation" });
    expect(ctx.includedKeys).toContain("workspace-memory");
    expect(ctx.includedKeys).toContain("site-memory");
    expect(ctx.includedKeys).toContain("brand-guidelines");
    expect(ctx.includedKeys).toContain("business-info");
    expect(ctx.prompt).toContain("Business: Beta Gym");
    expect(ctx.prompt).toContain("Source: example.com");
    expect(ctx.prompt).toContain("Accent: #ff4d00");
    expect(ctx.prompt.indexOf("Workspace context")).toBeLessThan(
      ctx.prompt.indexOf("Brand guidelines"),
    );
  });

  test("uses job-specific doc set for seo-report", () => {
    const docs = [
      makeDoc("workspace-memory", "Workspace memory", "Business: Beta Gym"),
      makeDoc("site-memory", "Site memory", "Source: example.com"),
      makeDoc("brand-guidelines", "Brand guidelines", "Accent: #ff4d00"),
      makeDoc("business-info", "Business info", "Phone: 555-1234"),
      makeDoc("site-strategy", "Site strategy", "Nav: Classes, Coaches"),
    ];
    const ctx = assembleMasterContext(docs, { job: "seo-report" });
    expect(ctx.includedKeys).toContain("business-info");
    expect(ctx.includedKeys).toContain("site-strategy");
    expect(ctx.includedKeys).not.toContain("brand-guidelines");
  });

  test("includeKeys overrides job preset", () => {
    const docs = [
      makeDoc("workspace-memory", "Workspace memory", "Business: Beta Gym"),
      makeDoc("site-memory", "Site memory", "Source: example.com"),
      makeDoc("faqs", "FAQs", "Q1: ..."),
    ];
    const ctx = assembleMasterContext(docs, { includeKeys: ["faqs"] });
    expect(ctx.includedKeys).toContain("faqs");
    expect(ctx.includedKeys).not.toContain("brand-guidelines");
  });

  test("warns when workspace memory is missing", () => {
    const docs = [makeDoc("brand-guidelines", "Brand guidelines", "Accent: #ff4d00")];
    const ctx = assembleMasterContext(docs, { job: "website-generation" });
    expect(ctx.warnings.length).toBeGreaterThan(0);
  });

  test("warns when requested doc is missing", () => {
    const docs = [makeDoc("workspace-memory", "Workspace memory", "Business: Beta Gym")];
    const ctx = assembleMasterContext(docs, { job: "website-generation" });
    expect(ctx.warnings.some((w) => w.includes("site-memory"))).toBe(true);
    expect(ctx.warnings.some((w) => w.includes("brand-guidelines"))).toBe(true);
  });

  test("truncates when content exceeds maxChars", () => {
    const docs = [makeDoc("workspace-memory", "Workspace memory", "x".repeat(20000))];
    const ctx = assembleMasterContext(docs, { job: "website-generation", maxChars: 5000 });
    expect(ctx.prompt.length).toBeLessThanOrEqual(6000);
    expect(ctx.warnings.some((w) => w.includes("truncated"))).toBe(true);
  });
});
