import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createType("ai_activity_outcome")
    .asEnum(["success", "partial", "failure", "user_edited", "rejected"])
    .execute();

  await db.schema
    .createType("ai_activity_action")
    .asEnum([
      "generate",
      "replicate",
      "edit",
      "qa",
      "publish",
      "memory_update",
      "suggest",
      "apply_suggestion",
    ])
    .execute();

  await db.schema
    .createTable("ai_activity")
    .addColumn("uuid", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("workspaceUuid", "uuid", (col) => col.notNull())
    .addColumn("siteUuid", "uuid", (col) => col.references("sites.uuid").onDelete("set null"))
    .addColumn("userUuid", "text", (col) => col.notNull())
    .addColumn("aiJobUuid", "uuid", (col) => col.references("ai_jobs.uuid").onDelete("set null"))
    .addColumn("actionType", sql`ai_activity_action`, (col) => col.notNull())
    .addColumn("model", "text")
    .addColumn("provider", "text")
    .addColumn("promptTemplateKeys", "text")
    .addColumn("inputDocKeys", "text")
    .addColumn("inputTokens", "integer")
    .addColumn("outputTokens", "integer")
    .addColumn("costUsd", "numeric")
    .addColumn("latencyMs", "integer")
    .addColumn("outcome", sql`ai_activity_outcome`, (col) => col.notNull())
    .addColumn("fidelityScore", "numeric")
    .addColumn("summary", "text", (col) => col.notNull())
    .addColumn("errorMessage", "text")
    .addColumn("userCorrection", "text")
    .addColumn("metadata", "jsonb")
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("ai_activity_workspace_created_idx")
    .on("ai_activity")
    .columns(["workspaceUuid", "createdAt"])
    .execute();

  await db.schema
    .createIndex("ai_activity_site_created_idx")
    .on("ai_activity")
    .columns(["siteUuid", "createdAt"])
    .execute();

  await db.schema
    .createIndex("ai_activity_action_outcome_idx")
    .on("ai_activity")
    .columns(["actionType", "outcome"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("ai_activity_action_outcome_idx").execute();
  await db.schema.dropIndex("ai_activity_site_created_idx").execute();
  await db.schema.dropIndex("ai_activity_workspace_created_idx").execute();
  await db.schema.dropTable("ai_activity").execute();
  await db.schema.dropType("ai_activity_action").execute();
  await db.schema.dropType("ai_activity_outcome").execute();
}
