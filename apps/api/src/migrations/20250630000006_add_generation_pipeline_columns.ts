import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE site_mode AS ENUM ('replication', 'template', 'greenfield')`.execute(db);

  await db.schema
    .alterTable("sites")
    .addColumn("mode", sql`site_mode`, (col) => col.notNull().defaultTo("greenfield"))
    .execute();

  await db.schema.alterTable("aiJobs").addColumn("state", "jsonb").execute();
  await db.schema.alterTable("aiJobs").addColumn("steps", "jsonb").execute();
  await db.schema.alterTable("aiJobs").addColumn("options", "jsonb").execute();

  await db.schema.alterTable("deployments").addColumn("preview_url", "text").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("deployments").dropColumn("preview_url").execute();

  await db.schema.alterTable("aiJobs").dropColumn("options").execute();
  await db.schema.alterTable("aiJobs").dropColumn("steps").execute();
  await db.schema.alterTable("aiJobs").dropColumn("state").execute();

  await db.schema.alterTable("sites").dropColumn("mode").execute();
  await sql`DROP TYPE IF EXISTS site_mode`.execute(db);
}
