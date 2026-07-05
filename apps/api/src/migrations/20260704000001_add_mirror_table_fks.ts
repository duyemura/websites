import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE site_transforms ADD CONSTRAINT site_transforms_site_uuid_fk FOREIGN KEY (site_uuid) REFERENCES sites(uuid) ON DELETE CASCADE`.execute(db);
  await sql`ALTER TABLE site_transforms ADD CONSTRAINT site_transforms_workspace_uuid_fk FOREIGN KEY (workspace_uuid) REFERENCES workspaces(uuid) ON DELETE CASCADE`.execute(db);
  await sql`ALTER TABLE leads ADD CONSTRAINT leads_site_uuid_fk FOREIGN KEY (site_uuid) REFERENCES sites(uuid) ON DELETE CASCADE`.execute(db);
  await sql`ALTER TABLE leads ADD CONSTRAINT leads_workspace_uuid_fk FOREIGN KEY (workspace_uuid) REFERENCES workspaces(uuid) ON DELETE CASCADE`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_workspace_uuid_fk`.execute(db);
  await sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_site_uuid_fk`.execute(db);
  await sql`ALTER TABLE site_transforms DROP CONSTRAINT IF EXISTS site_transforms_workspace_uuid_fk`.execute(db);
  await sql`ALTER TABLE site_transforms DROP CONSTRAINT IF EXISTS site_transforms_site_uuid_fk`.execute(db);
}
