import { beforeEach, afterAll } from "vitest";
import { db } from "../src/database";
import { sql } from "kysely";

async function resetDatabase() {
  const tables = [
    "ai_jobs",
    "asset_generations",
    "ai_activity",
    "workspace_brand_memory",
    "deployments",
    "playbooks",
    "templates",
    "pipeline_artifacts",
    "assets",
    "docs",
    "pages",
    "leads",
    "site_transforms",
    "sites",
    "themes",
    "workspace_memberships",
    "organization_memberships",
    "workspaces",
    "organizations",
    "users",
  ];

  for (const table of tables) {
    await sql`TRUNCATE TABLE ${sql.table(table)} CASCADE`.execute(db);
  }
}

async function seedWorkspace() {
  const user = await db
    .insertInto("users")
    .values({
      email: "test@ploygyms.dev",
      name: "Test User",
      externalUserId: "test-user",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const organization = await db
    .insertInto("organizations")
    .values({
      slug: "test-org",
      name: "Test Org",
      ownerUserUuid: user.uuid,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const workspace = await db
    .insertInto("workspaces")
    .values({
      slug: "test-workspace",
      name: "Test Workspace",
      ownerUserId: user.externalUserId,
      organizationUuid: organization.uuid,
      status: "active",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto("workspaceMemberships")
    .values({
      workspaceUuid: workspace.uuid,
      userUuid: user.uuid,
      role: "owner",
    })
    .execute();

  return { user, workspace };
}

export async function setupTestContext() {
  await resetDatabase();
  return seedWorkspace();
}

beforeEach(async () => {
  await resetDatabase();
  await seedWorkspace();
});

afterAll(async () => {
  await db.destroy();
});
