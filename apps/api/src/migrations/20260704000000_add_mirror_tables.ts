import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("site_transforms")
    .addColumn("uuid", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("site_uuid", "uuid", (c) => c.notNull())
    .addColumn("workspace_uuid", "uuid", (c) => c.notNull())
    .addColumn("ordinal", "integer", (c) => c.notNull())
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("page_glob", "text", (c) => c.notNull())
    .addColumn("selector", "text")
    .addColumn("payload", "jsonb", (c) => c.notNull())
    .addColumn("author", "text", (c) => c.notNull().defaultTo("human"))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("site_transforms_site_uuid_idx")
    .on("site_transforms")
    .columns(["site_uuid", "status", "ordinal"])
    .execute();

  await db.schema
    .createTable("leads")
    .addColumn("uuid", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("site_uuid", "uuid", (c) => c.notNull())
    .addColumn("workspace_uuid", "uuid", (c) => c.notNull())
    .addColumn("form_id", "text", (c) => c.notNull())
    .addColumn("fields", "jsonb", (c) => c.notNull())
    .addColumn("source_path", "text")
    .addColumn("ip", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("leads_site_uuid_idx")
    .on("leads")
    .columns(["site_uuid", "created_at"])
    .execute();

  await db.schema
    .alterTable("sites")
    .addColumn("mirror_status", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("sites").dropColumn("mirror_status").execute();
  await db.schema.dropTable("leads").execute();
  await db.schema.dropTable("site_transforms").execute();
}
