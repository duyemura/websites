import dotenv from "dotenv";

dotenv.config({ path: "./.env.test" });
dotenv.config({ path: "./.env.test.local", override: true });

import { build } from "../test/helper";
import { db } from "../src/database";
import { sql } from "kysely";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function resetDatabase() {
  const tables = [
    "ai_jobs",
    "asset_generations",
    "ai_activity",
    "workspace_brand_memory",
    "deployments",
    "playbooks",
    "templates",
    "assets",
    "docs",
    "pages",
    "sites",
    "themes",
    "workspace_memberships",
    "organization_memberships",
    "workspaces",
    "organizations",
    "users",
  ];
  for (const table of tables) {
    await sql`TRUNCATE TABLE ${sql.table(table)} CASCADE`.execute(db);
  }
}

async function seedWorkspace() {
  const user = await db
    .insertInto("users")
    .values({
      email: "demo@ploygyms.dev",
      name: "Demo User",
      externalUserId: "demo-user",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const organization = await db
    .insertInto("organizations")
    .values({
      slug: "demo-org",
      name: "Demo Org",
      ownerUserUuid: user.uuid,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const workspace = await db
    .insertInto("workspaces")
    .values({
      slug: "demo-workspace",
      name: "Demo Workspace",
      ownerUserId: user.externalUserId,
      organizationUuid: organization.uuid,
      status: "active",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto("workspaceMemberships")
    .values({
      workspaceUuid: workspace.uuid,
      userUuid: user.uuid,
      role: "owner",
    })
    .execute();

  return { user, workspace };
}

async function main() {
  await resetDatabase();
  const { workspace } = await seedWorkspace();
  const app = await build();

  // Prevent an actual worker from running expensive generation jobs during the demo.
  const originalGenerateAdd = app.queues.generateAssets.queue.add.bind(
    app.queues.generateAssets.queue,
  );
  const generateAddCalls: unknown[][] = [];
  app.queues.generateAssets.queue.add = async (...args: unknown[]) => {
    generateAddCalls.push(args);
    return { id: "demo-job-id" } as Awaited<
      ReturnType<typeof app.queues.generateAssets.queue.add>
    >;
  };

  // Override test auth to point at the seeded workspace.
  const headers = {
    authorization: "Bearer demo-user",
    "x-workspace-slug": "demo-workspace",
  };

  try {
    console.log("\n=== Happy path 1: get a signed S3 upload URL ===");
    const uploadUrlResp = await app.inject({
      method: "GET",
      url: "/api/assets/upload-url?filename=demo-asset.png&contentType=image/png",
      headers,
    });
    const uploadUrl = JSON.parse(uploadUrlResp.body);
    console.log("status:", uploadUrlResp.statusCode);
    console.log("storageKey:", uploadUrl.storageKey);
    console.log("publicUrl:", uploadUrl.publicUrl);

    console.log("\n=== Happy path 2: upload a 1x1 PNG to S3 ===");
    const s3Resp = await fetch(uploadUrl.signedUrl, {
      method: "PUT",
      body: ONE_BY_ONE_PNG,
      headers: { "Content-Type": "image/png" },
    });
    console.log("s3 PUT status:", s3Resp.status);
    if (!s3Resp.ok) {
      console.error("s3 PUT body:", await s3Resp.text());
      throw new Error("Failed to upload to S3");
    }

    console.log("\n=== Happy path 3: create the asset record ===");
    const createResp = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers,
      payload: {
        name: "Demo hero image",
        type: "image",
        source: "upload",
        mimeType: "image/png",
        url: uploadUrl.publicUrl,
        storageKey: uploadUrl.storageKey,
      },
    });
    const asset = JSON.parse(createResp.body);
    console.log("status:", createResp.statusCode);
    console.log("asset uuid:", asset.uuid);
    console.log("asset url:", asset.url);
    console.log("signedUrl present:", Boolean(asset.signedUrl));

    console.log("\n=== Happy path 4: list assets ===");
    const listResp = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers,
    });
    const assets = JSON.parse(listResp.body);
    console.log("status:", listResp.statusCode);
    console.log("count:", assets.length);
    console.log("first asset name:", assets[0]?.name);

    console.log("\n=== Happy path 5: regenerate analysis for the asset ===");
    const regenResp = await app.inject({
      method: "POST",
      url: `/api/assets/${asset.uuid}/regenerate-analysis`,
      headers,
    });
    console.log("status:", regenResp.statusCode);
    console.log("body:", JSON.parse(regenResp.body));

    console.log("\n=== Happy path 6: backfill analysis across workspace ===");
    const backfillResp = await app.inject({
      method: "POST",
      url: "/api/assets/backfill-analysis",
      headers,
    });
    console.log("status:", backfillResp.statusCode);
    console.log("body:", JSON.parse(backfillResp.body));

    console.log("\n=== Happy path 7: request AI image generation ===");
    const genResp = await app.inject({
      method: "POST",
      url: "/api/asset-generations",
      headers,
      payload: {
        workspaceUuid: workspace.uuid,
        useCase: "hero",
        subject: "Empty gym floor at sunrise",
        referenceAssetUuids: [asset.uuid],
        outputSpec: { aspectRatio: "16:9", style: "cinematic" },
      },
    });
    const generation = JSON.parse(genResp.body);
    console.log("status:", genResp.statusCode);
    console.log("generation uuid:", generation.uuid);
    console.log("status:", generation.status);
    console.log("queue.add calls:", generateAddCalls.length);

    console.log("\n=== Happy path 8: simulate failure and retry ===");
    await db
      .updateTable("assetGenerations")
      .set({ status: "failed", failureReason: "Demo failure" })
      .where("uuid", "=", generation.uuid)
      .execute();

    const retryResp = await app.inject({
      method: "POST",
      url: `/api/asset-generations/${generation.uuid}/retry`,
      headers,
    });
    const retryBody = JSON.parse(retryResp.body);
    console.log("status:", retryResp.statusCode);
    console.log("body:", retryBody);

    console.log("\n=== Happy path 9: delete the generation ===");
    const delGenResp = await app.inject({
      method: "DELETE",
      url: `/api/asset-generations/${generation.uuid}`,
      headers,
    });
    console.log("status:", delGenResp.statusCode);

    console.log("\n=== Happy path 10: cleanup the asset (also deletes S3 object) ===");
    const delAssetResp = await app.inject({
      method: "DELETE",
      url: `/api/assets/${asset.uuid}`,
      headers,
    });
    console.log("status:", delAssetResp.statusCode);

    console.log("\n=== All happy paths completed ===");
  } finally {
    app.queues.generateAssets.queue.add = originalGenerateAdd;
    await app.close();
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
