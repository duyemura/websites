import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("pipelineArtifacts")
    .addColumn("uuid", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("siteUuid", "uuid", (col) => col.notNull())
    .addColumn("workspaceUuid", "uuid", (col) => col.notNull())
    .addColumn("stage", "varchar(16)", (col) => col.notNull())
    .addColumn("version", "integer", (col) => col.notNull())
    .addColumn("payload", "jsonb", (col) => col.notNull())
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("pipeline_artifacts_site_stage_idx")
    .unique()
    .on("pipelineArtifacts")
    .columns(["siteUuid", "stage", "version"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("pipeline_artifacts_site_stage_idx")
    .execute();
  await db.schema.dropTable("pipelineArtifacts").execute();
}
