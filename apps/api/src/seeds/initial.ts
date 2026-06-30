import { Kysely, sql } from "kysely";
import { DB } from "../types/db";

export async function seed(db: Kysely<DB>): Promise<void> {
  const existingWorkspace = await db
    .selectFrom("workspaces")
    .select("uuid")
    .where("slug", "=", "local")
    .executeTakeFirst();

  if (existingWorkspace) {
    return;
  }

  const user = await db
    .insertInto("users")
    .values({
      email: "local@ploygyms.dev",
      name: "Local User",
      externalUserId: "local-dev-user",
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();

  const organization = await db
    .insertInto("organizations")
    .values({
      slug: "local-agency",
      name: "Local Agency",
      ownerUserUuid: user.uuid,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("organizationMemberships")
    .values({
      organizationUuid: organization.uuid,
      userUuid: user.uuid,
      role: "owner",
    })
    .execute();

  const workspace = await db
    .insertInto("workspaces")
    .values({
      slug: "local",
      name: "Local Gym",
      status: "active",
      organizationUuid: organization.uuid,
      ownerUserId: user.uuid,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("workspaceMemberships")
    .values({
      workspaceUuid: workspace.uuid,
      userUuid: user.uuid,
      role: "owner",
    })
    .execute();

  await db
    .insertInto("playbooks")
    .values([
      {
        key: "create-homepage",
        name: "Create homepage",
        description: "Generate a complete gym homepage from workspace docs and brand guidelines.",
        category: "Design",
        isSystem: true,
        inputSchema: sql`${JSON.stringify({
          type: "object",
          properties: {
            tone: { type: "string", default: "energetic" },
          },
        })}::jsonb`,
        steps: sql`${JSON.stringify([
          { name: "Load workspace memory", action: "load_docs" },
          { name: "Generate theme", action: "generate_theme" },
          { name: "Generate homepage page", action: "generate_page" },
          { name: "Build preview", action: "build_preview" },
        ])}::jsonb`,
      },
      {
        key: "replicate-website",
        name: "Replicate my website",
        description: "Import an existing website URL, extract structure, and map it to gym-specific sections.",
        category: "Import",
        isSystem: true,
        inputSchema: sql`${JSON.stringify({
          type: "object",
          properties: {
            url: { type: "string" },
          },
          required: ["url"],
        })}::jsonb`,
        steps: sql`${JSON.stringify([
          { name: "Scrape target URL", action: "scrape" },
          { name: "Classify sections", action: "classify" },
          { name: "Map to gym sections", action: "map_sections" },
          { name: "Generate assets", action: "generate_assets" },
        ])}::jsonb`,
      },
      {
        key: "add-seo-page",
        name: "Add SEO content page",
        description: "Generate a long-form SEO landing page for a service or location.",
        category: "SEO",
        isSystem: true,
        inputSchema: sql`${JSON.stringify({
          type: "object",
          properties: {
            topic: { type: "string" },
            location: { type: "string" },
          },
          required: ["topic"],
        })}::jsonb`,
        steps: sql`${JSON.stringify([
          { name: "Research topic", action: "research" },
          { name: "Generate content", action: "generate_content" },
          { name: "Publish page", action: "publish_page" },
        ])}::jsonb`,
      },
    ])
    .execute();
}
