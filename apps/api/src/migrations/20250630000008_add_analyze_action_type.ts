import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TYPE ai_activity_action ADD VALUE IF NOT EXISTS 'analyze'`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // PostgreSQL does not support dropping individual enum values. Recreating
  // the enum would require updating every column that uses it, which is
  // disproportionately risky for a simple action label.
}
