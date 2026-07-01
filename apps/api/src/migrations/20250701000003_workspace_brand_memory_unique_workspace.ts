import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("workspace_brand_memory_workspace_uuid_idx")
    .ifExists()
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

  await db.schema
    .createIndex("workspace_brand_memory_workspace_uuid_idx")
    .on("workspaceBrandMemory")
    .column("workspaceUuid")
    .execute();
}
