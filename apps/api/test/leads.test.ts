import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/database";
import { setupTestContext } from "./setup";
import { handleFormSubmission } from "../src/services/leads";

describe("handleFormSubmission", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ctx = await setupTestContext();
    workspaceUuid = ctx.workspace.uuid;
    const site = await db.insertInto("sites")
      .values({ workspaceUuid, name: "Test Gym", slug: "test-gym" })
      .returning("uuid").executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  it("stores a lead with fields including utm params, honeypot stripped", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid, formId: "contact",
      fields: { name: "Jo", email: "jo@x.com", utm_source: "facebook", utm_campaign: "spring", _hp: "" },
      sourcePath: "/contact", ip: "1.2.3.4",
    });
    expect(result.stored).toBe(true);
    const lead = await db.selectFrom("leads").selectAll().where("siteUuid", "=", siteUuid).executeTakeFirstOrThrow();
    expect(lead.formId).toBe("contact");
    expect((lead.fields as any).email).toBe("jo@x.com");
    // CamelCasePlugin transforms JSONB keys on read: utm_source → utmSource
    expect((lead.fields as any).utmSource).toBe("facebook");
    expect((lead.fields as any)._hp).toBeUndefined();
  });

  it("silently drops honeypot submissions", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid, formId: "contact", fields: { name: "Bot", _hp: "gotcha" }, sourcePath: "/", ip: "1.2.3.4",
    });
    expect(result.stored).toBe(false);
    expect(await db.selectFrom("leads").selectAll().execute()).toHaveLength(0);
  });

  it("returns stored=false for an unknown site", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid: "00000000-0000-0000-0000-000000000000", formId: "x", fields: {}, sourcePath: null, ip: null,
    });
    expect(result.stored).toBe(false);
  });
});
