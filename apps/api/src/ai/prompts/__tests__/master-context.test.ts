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
  test("includes workspace and site memory first", () => {
    const docs = [
      makeDoc("workspace-memory", "Workspace memory", "Business: Beta Gym"),
      makeDoc("site-memory", "Site memory", "Source: example.com"),
      makeDoc("brand-guidelines", "Brand guidelines", "Accent: #ff4d00"),
    ];
    const ctx = assembleMasterContext(docs);
    expect(ctx.includedKeys).toContain("workspace-memory");
    expect(ctx.includedKeys).toContain("site-memory");
    expect(ctx.prompt).toContain("Business: Beta Gym");
    expect(ctx.prompt).toContain("Source: example.com");
    expect(ctx.prompt).toContain("Accent: #ff4d00");
    expect(ctx.prompt.indexOf("Workspace context")).toBeLessThan(ctx.prompt.indexOf("Brand guidelines"));
  });

  test("warns when workspace memory is missing", () => {
    const docs = [makeDoc("brand-guidelines", "Brand guidelines", "Accent: #ff4d00")];
    const ctx = assembleMasterContext(docs);
    expect(ctx.warnings.length).toBeGreaterThan(0);
  });

  test("truncates when content exceeds maxChars", () => {
    const docs = [makeDoc("workspace-memory", "Workspace memory", "x".repeat(20000))];
    const ctx = assembleMasterContext(docs, { maxChars: 5000 });
    expect(ctx.prompt.length).toBeLessThanOrEqual(6000);
    expect(ctx.warnings.some((w) => w.includes("truncated"))).toBe(true);
  });
});
