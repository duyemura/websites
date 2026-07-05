import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import { loadActiveTransforms, markStaleTransforms } from "../../src/services/mirror/deploy";
import { jsonb } from "../../src/utils/jsonb";

describe("deploy transform loading", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ctx = await setupTestContext();
    workspaceUuid = ctx.workspace.uuid;
    const site = await db
      .insertInto("sites")
      .values({ workspaceUuid, name: "Test Gym", slug: "test-gym" })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  it("loads only active transforms ordered by ordinal", async () => {
    await db.insertInto("siteTransforms").values([
      { siteUuid, workspaceUuid, ordinal: 2, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "B" }) },
      { siteUuid, workspaceUuid, ordinal: 1, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "A" }) },
      { siteUuid, workspaceUuid, ordinal: 3, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "C" }), status: "disabled" },
    ]).execute();

    const transforms = await loadActiveTransforms(db, siteUuid);
    expect(transforms.map((t) => t.ordinal)).toEqual([1, 2]);
  });

  it("marks stale transforms by uuid", async () => {
    const row = await db.insertInto("siteTransforms")
      .values({ siteUuid, workspaceUuid, ordinal: 1, type: "attr-set", pageGlob: "/", selector: ".gone", payload: jsonb({ attr: "alt", value: "x" }) })
      .returning("uuid").executeTakeFirstOrThrow();

    await markStaleTransforms(db, [row.uuid]);
    const after = await db.selectFrom("siteTransforms").select("status").where("uuid", "=", row.uuid).executeTakeFirstOrThrow();
    expect(after.status).toBe("stale");
  });
});
