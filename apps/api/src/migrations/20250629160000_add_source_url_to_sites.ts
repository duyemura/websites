import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("sites")
    .addColumn("source_url", "text")
    .execute();

  await db.schema
    .createIndex("sites_source_url_idx")
    .on("sites")
    .column("source_url")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("sites_source_url_idx").on("sites").execute();
  await db.schema.alterTable("sites").dropColumn("source_url").execute();
}
