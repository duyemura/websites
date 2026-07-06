import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("site_versions")
    .addColumn("uuid", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("site_uuid", "uuid", (c) => c.notNull().references("sites.uuid").onDelete("cascade"))
    .addColumn("workspace_uuid", "uuid", (c) => c.notNull().references("workspaces.uuid").onDelete("cascade"))
    .addColumn("version", "integer", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull()) // 'mirror' | 'template'
    .addColumn("deploy_prefix", "text", (c) => c.notNull())
    .addColumn("label", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("published_at", "timestamptz")
    .execute();
  await sql`CREATE UNIQUE INDEX site_versions_site_version_idx ON site_versions (site_uuid, version)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("site_versions").execute();
}
