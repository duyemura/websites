import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/database";
import { setupTestContext } from "./setup";
import { recordSiteVersion, publishSiteVersion, listSiteVersions } from "../src/services/site-versions";

function mockS3() {
  // publishSiteVersion delegates S3 work to promoteDeploy — a no-op-ish mock suffices here.
  return { send: vi.fn(async () => ({ Contents: [], IsTruncated: false })) } as any;
}

describe("site versions", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ctx = await setupTestContext();
    workspaceUuid = ctx.workspace.uuid;
    const site = await db.insertInto("sites")
      .values({ workspaceUuid, name: "G", slug: "g" })
      .returning("uuid").executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  it("records sequential versions starting at 1", async () => {
    const v1 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "mirror", deployPrefix: "sites/x/deploys/a", label: "Initial mirror" });
    const v2 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "template", deployPrefix: "sites/x/deploys/b", label: "Template v1" });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  it("publish stamps published_at and promotes to current/", async () => {
    const v1 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "mirror", deployPrefix: "sites/x/deploys/a" });
    const s3 = mockS3();
    await publishSiteVersion(db, s3, "bucket", siteUuid, v1.version);
    const rows = await listSiteVersions(db, siteUuid);
    expect(rows[0].publishedAt).not.toBeNull();
    expect(s3.send).toHaveBeenCalled(); // promoteDeploy listed the prefix
  });

  it("rollback = publishing an older version again", async () => {
    const v1 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "mirror", deployPrefix: "sites/x/deploys/a" });
    await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "template", deployPrefix: "sites/x/deploys/b" });
    const s3 = mockS3();
    await publishSiteVersion(db, s3, "bucket", siteUuid, 2);
    await publishSiteVersion(db, s3, "bucket", siteUuid, v1.version); // rollback
    const rows = await listSiteVersions(db, siteUuid);
    const one = rows.find((r) => r.version === 1)!;
    const two = rows.find((r) => r.version === 2)!;
    expect(one.publishedAt!.getTime()).toBeGreaterThan(two.publishedAt!.getTime());
  });

  it("publishing an unknown version throws", async () => {
    await expect(publishSiteVersion(db, mockS3(), "bucket", siteUuid, 99)).rejects.toThrow();
  });
});
