import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("site_evals")
    .addColumn("uuid", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("site_uuid", "uuid", (c) => c.notNull().references("sites.uuid").onDelete("cascade"))
    .addColumn("workspace_uuid", "uuid", (c) => c.notNull().references("workspaces.uuid").onDelete("cascade"))
    .addColumn("job_id", "text")
    .addColumn("status", "text", (c) => c.notNull()) // queued | running | passed | failed
    .addColumn("avg_similarity", "smallint")
    .addColumn("page_count", "smallint")
    .addColumn("pass_count", "smallint")
    .addColumn("form_status", "text")
    .addColumn("warnings", "jsonb", (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("pages", "jsonb", (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("failed_reason", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("completed_at", "timestamptz")
    .execute();

  await sql`CREATE INDEX site_evals_site_created_idx ON site_evals (site_uuid, created_at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("site_evals").execute();
}
