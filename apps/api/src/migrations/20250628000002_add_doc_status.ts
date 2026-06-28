import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createType("doc_status")
    .asEnum(["active", "archived"])
    .execute();

  await db.schema
    .alterTable("docs")
    .addColumn("status", sql`doc_status`, (col) =>
      col.notNull().defaultTo("active"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("docs").dropColumn("status").execute();
  await db.schema.dropType("doc_status").execute();
}
