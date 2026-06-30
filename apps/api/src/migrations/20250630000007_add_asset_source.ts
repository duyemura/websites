import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createType("asset_source")
    .asEnum(["upload", "scraped", "screenshot", "ai_generated"])
    .execute();

  await db.schema
    .alterTable("assets")
    .addColumn("source", sql`asset_source`, (col) =>
      col.notNull().defaultTo("upload"),
    )
    .execute();

  await db.schema
    .createIndex("assets_workspace_source_idx")
    .on("assets")
    .columns(["workspace_uuid", "source"])
    .execute();

  await sql`
    update assets
    set source = 'screenshot'
    where metadata->'tags' @> '["screenshot"]'::jsonb
      or metadata->'tags' @> '["reference-screenshot"]'::jsonb
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("assets_workspace_source_idx")
    .on("assets")
    .execute();

  await db.schema
    .alterTable("assets")
    .dropColumn("source")
    .execute();

  await db.schema.dropType("asset_source").execute();
}
