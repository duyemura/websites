import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TYPE site_tier AS ENUM ('free', 'paid')`.execute(db);
  await sql`ALTER TABLE sites ADD COLUMN tier site_tier NOT NULL DEFAULT 'free'`.
    execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sites DROP COLUMN IF EXISTS tier`.execute(db);
  await sql`DROP TYPE IF EXISTS site_tier`.execute(db);
}
