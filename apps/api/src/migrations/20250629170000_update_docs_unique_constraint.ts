import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("docs")
    .dropConstraint("docs_workspace_key_unique")
    .execute();

  // PostgreSQL treats NULL as distinct, so a single (workspace_uuid, site_uuid, key)
  // unique constraint would allow multiple workspace-level docs for the same key.
  // Use two partial unique indexes instead.
  await db.schema
    .createIndex("docs_workspace_key_unique_partial")
    .on("docs")
    .columns(["workspace_uuid", "key"])
    .unique()
    .where(sql`site_uuid IS NULL`)
    .execute();

  await db.schema
    .createIndex("docs_workspace_site_key_unique_partial")
    .on("docs")
    .columns(["workspace_uuid", "site_uuid", "key"])
    .unique()
    .where(sql`site_uuid IS NOT NULL`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("docs_workspace_key_unique_partial").execute();
  await db.schema.dropIndex("docs_workspace_site_key_unique_partial").execute();

  await db.schema
    .alterTable("docs")
    .addUniqueConstraint("docs_workspace_key_unique", ["workspace_uuid", "key"])
    .execute();
}
