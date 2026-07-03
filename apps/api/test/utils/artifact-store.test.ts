import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import {
  saveArtifact,
  loadArtifact,
  loadArtifactVersion,
  type ArtifactContext,
} from "../../src/utils/pipeline/artifact-store";
import { jsonb } from "../../src/utils/jsonb";

async function seedContext(): Promise<ArtifactContext> {
  const { workspace } = await setupTestContext();
  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid: workspace.uuid,
      name: "Test Site",
      slug: `test-site-${Date.now()}`,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, workspaceUuid: workspace.uuid };
}

describe("artifact-store", () => {
  let ctx: ArtifactContext;

  beforeEach(async () => {
    ctx = await seedContext();
  });

  it("saves with incrementing versions and loads the latest", async () => {
    await saveArtifact(db, ctx, "extract", { a: 1 });
    await saveArtifact(db, ctx, "extract", { a: 2 });
    const latest = await loadArtifact<{ a: number }>(db, ctx, "extract");
    expect(latest?.version).toBe(2);
    expect(latest?.payload).toEqual({ a: 2 });
  });

  it("keeps only the last 3 versions", async () => {
    for (let i = 1; i <= 5; i++) {
      await saveArtifact(db, ctx, "segment", { i });
    }
    const v1 = await loadArtifactVersion(db, ctx, "segment", 1);
    const v3 = await loadArtifactVersion<{ i: number }>(db, ctx, "segment", 3);
    expect(v1).toBeNull();
    expect(v3?.payload).toEqual({ i: 3 });
  });

  it("returns null when no artifact exists", async () => {
    expect(await loadArtifact(db, ctx, "verify")).toBeNull();
  });

  it("rejects duplicate versions via unique constraint", async () => {
    await saveArtifact(db, ctx, "extract", { a: 1 });
    await expect(
      db
        .insertInto("pipelineArtifacts")
        .values({
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          stage: "extract",
          version: 1,
          payload: jsonb({ a: 2 }),
        })
        .execute(),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});
