import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("site_evals")
    .addColumn("report", "jsonb", (c) => c.defaultTo(sql`'{}'::jsonb`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("site_evals").dropColumn("report").execute();
}
