import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("docs")
    .addColumn("site_uuid", "uuid", (col) => col.references("sites.uuid").onDelete("set null"))
    .execute();

  await db.schema
    .createIndex("docs_site_uuid_idx")
    .on("docs")
    .column("site_uuid")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("docs_site_uuid_idx").on("docs").execute();
  await db.schema.alterTable("docs").dropColumn("site_uuid").execute();
}
