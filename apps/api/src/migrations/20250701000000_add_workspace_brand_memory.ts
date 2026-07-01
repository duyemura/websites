import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("workspaceBrandMemory")
    .addColumn("uuid", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("workspaceUuid", "uuid", (col) =>
      col.references("workspaces.uuid").onDelete("cascade").notNull(),
    )
    .addColumn("businessName", "text")
    .addColumn("businessArchetype", "text")
    .addColumn("mood", "text")
    .addColumn("lighting", "text")
    .addColumn("colorPalette", "jsonb")
    .addColumn("interiorAndFinishes", "text")
    .addColumn("equipmentTags", "jsonb")
    .addColumn("signageNotes", "text")
    .addColumn("imageryStrategy", "text")
    .addColumn("promptKeywords", "jsonb")
    .addColumn("differentiators", "jsonb")
    .addColumn("richContext", "jsonb")
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("workspace_brand_memory_workspace_uuid_idx")
    .unique()
    .on("workspaceBrandMemory")
    .column("workspaceUuid")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("workspace_brand_memory_workspace_uuid_idx")
    .execute();
  await db.schema.dropTable("workspaceBrandMemory").execute();
}
