import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "../../database";
import { handleFormSubmission, listLeads } from "../leads";

describe("leads service", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ws = await db
      .insertInto("workspaces")
      .values({ name: "Test Gym", slug: `test-gym-${Date.now()}` })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    workspaceUuid = ws.uuid;

    const site = await db
      .insertInto("sites")
      .values({ name: "Test Site", slug: `test-site-${Date.now()}`, workspaceUuid })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  afterEach(async () => {
    await db.deleteFrom("leads").where("siteUuid", "=", siteUuid).execute();
    await db.deleteFrom("sites").where("uuid", "=", siteUuid).execute();
    await db.deleteFrom("workspaces").where("uuid", "=", workspaceUuid).execute();
  });

  test("stores lead and normalizes email, phone, name", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid,
      formId: "form-abc",
      fields: {
        email: "jane@gym.com",
        phone: "555-1234",
        name: "Jane Smith",
        message: "I'd like to sign up",
      },
      sourcePath: "/contact",
      ip: "1.2.3.4",
    });
    expect(result.stored).toBe(true);

    const row = await db
      .selectFrom("leads")
      .selectAll()
      .where("siteUuid", "=", siteUuid)
      .executeTakeFirstOrThrow();

    expect(row.email).toBe("jane@gym.com");
    expect(row.phone).toBe("555-1234");
    expect(row.name).toBe("Jane Smith");
    expect((row.fields as Record<string, unknown>)["message"]).toBe("I'd like to sign up");
  });

  test("drops honeypot submissions", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid,
      formId: "form-abc",
      fields: { _hp: "bot@spam.com", email: "bot@spam.com" },
      sourcePath: null,
      ip: "1.2.3.4",
    });
    expect(result.stored).toBe(false);
    const count = await db
      .selectFrom("leads")
      .select(({ fn }) => [fn.countAll().as("n")])
      .where("siteUuid", "=", siteUuid)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(0);
  });

  test("normalizes fields by common name patterns", async () => {
    await handleFormSubmission(db, {
      siteUuid,
      formId: "form-webflow",
      fields: { "your-email": "test@example.com", "full-name": "Bob", "your-phone": "999-0000" },
      sourcePath: "/",
      ip: null,
    });
    const row = await db
      .selectFrom("leads")
      .selectAll()
      .where("siteUuid", "=", siteUuid)
      .executeTakeFirstOrThrow();
    expect(row.email).toBe("test@example.com");
    expect(row.name).toBe("Bob");
    expect(row.phone).toBe("999-0000");
  });

  test("listLeads returns leads for a site, newest first", async () => {
    await handleFormSubmission(db, {
      siteUuid, formId: "f1",
      fields: { email: "a@a.com" }, sourcePath: "/", ip: null,
    });
    await handleFormSubmission(db, {
      siteUuid, formId: "f2",
      fields: { email: "b@b.com" }, sourcePath: "/about", ip: null,
    });
    const page = await listLeads(db, { siteUuid, workspaceUuid, page: 1, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.leads.length).toBe(2);
    expect(page.leads[0].email).toBe("b@b.com"); // newest first
  });
});
