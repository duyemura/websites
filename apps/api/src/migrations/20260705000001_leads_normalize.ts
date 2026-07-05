import { type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("leads")
    .addColumn("email", "text")
    .addColumn("phone", "text")
    .addColumn("name", "text")
    .execute();

  await db.schema
    .alterTable("sites")
    .addColumn("notify_email", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("leads").dropColumn("email").execute();
  await db.schema.alterTable("leads").dropColumn("phone").execute();
  await db.schema.alterTable("leads").dropColumn("name").execute();
  await db.schema.alterTable("sites").dropColumn("notify_email").execute();
}
