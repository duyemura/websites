import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createType("asset_generation_use_case")
    .asEnum([
      "hero",
      "background",
      "b_roll",
      "social",
      "program_page",
      "blog_header",
    ])
    .execute();

  await db.schema
    .createType("asset_generation_status")
    .asEnum([
      "pending",
      "generating",
      "uploaded",
      "analyzing",
      "ready",
      "failed",
    ])
    .execute();

  await db.schema
    .createTable("assetGenerations")
    .addColumn("uuid", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("workspaceUuid", "uuid", (col) => col.notNull())
    .addColumn("siteUuid", "uuid", (col) =>
      col.references("sites.uuid").onDelete("set null"),
    )
    .addColumn("userUuid", "text", (col) => col.notNull())
    .addColumn("useCase", sql`asset_generation_use_case`, (col) =>
      col.notNull(),
    )
    .addColumn("subject", "text", (col) => col.notNull())
    .addColumn("referenceAssetUuids", "jsonb")
    .addColumn("outputSpec", "jsonb", (col) => col.notNull())
    .addColumn("status", sql`asset_generation_status`, (col) =>
      col.notNull().defaultTo("pending"),
    )
    .addColumn("generatedAssetUuid", "uuid", (col) =>
      col.references("assets.uuid").onDelete("set null"),
    )
    .addColumn("promptSnapshot", "jsonb")
    .addColumn("provider", "text")
    .addColumn("providerJobId", "text")
    .addColumn("costUsd", "numeric")
    .addColumn("retries", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("failureReason", "text")
    .addColumn("metadata", "jsonb")
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("asset_generations_workspace_created_idx")
    .on("assetGenerations")
    .columns(["workspaceUuid", "createdAt"])
    .execute();

  await db.schema
    .createIndex("asset_generations_site_created_idx")
    .on("assetGenerations")
    .columns(["siteUuid", "createdAt"])
    .execute();

  await db.schema
    .createIndex("asset_generations_status_idx")
    .on("assetGenerations")
    .column("status")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("asset_generations_status_idx")
    .execute();
  await db.schema
    .dropIndex("asset_generations_site_created_idx")
    .execute();
  await db.schema
    .dropIndex("asset_generations_workspace_created_idx")
    .execute();
  await db.schema.dropTable("assetGenerations").execute();
  await db.schema.dropType("asset_generation_status").execute();
  await db.schema.dropType("asset_generation_use_case").execute();
}
