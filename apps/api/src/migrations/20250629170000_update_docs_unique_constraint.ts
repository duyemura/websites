import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("docs")
    .dropConstraint("docs_workspace_key_unique")
    .execute();

  await db.schema
    .alterTable("docs")
    .addUniqueConstraint("docs_workspace_site_key_unique", [
      "workspace_uuid",
      "site_uuid",
      "key",
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("docs")
    .dropConstraint("docs_workspace_site_key_unique")
    .execute();

  await db.schema
    .alterTable("docs")
    .addUniqueConstraint("docs_workspace_key_unique", ["workspace_uuid", "key"])
    .execute();
}
