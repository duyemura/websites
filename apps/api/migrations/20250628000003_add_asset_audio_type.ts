import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'audio'`.execute(db);
}

export async function down(): Promise<void> {
  // Enum values cannot be removed in PostgreSQL safely without recreating the type.
}
