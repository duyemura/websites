import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { SiteBlueprint } from "./site-blueprint";

const BLUEPRINT_DOC_KEY = "blueprint-draft";

const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/;

export async function loadBlueprintDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
): Promise<SiteBlueprint | null> {
  const doc = await db
    .selectFrom("docs")
    .select("content")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", BLUEPRINT_DOC_KEY)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (!doc?.content) return null;

  const match = doc.content.match(JSON_FENCE_RE);
  const jsonText = match?.[1] ?? doc.content;
  try {
    return JSON.parse(jsonText) as SiteBlueprint;
  } catch {
    return null;
  }
}

export async function saveBlueprintDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  blueprint: SiteBlueprint,
): Promise<void> {
  const content = `# Blueprint draft

This doc holds the current JSON blueprint for the site, including the build plan.

## Site blueprint

\`\`\`json
${JSON.stringify(blueprint, null, 2)}
\`\`\`
`;

  const existing = await db
    .selectFrom("docs")
    .select("uuid")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", BLUEPRINT_DOC_KEY)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable("docs")
      .set({ content, updatedAt: new Date() })
      .where("uuid", "=", existing.uuid)
      .execute();
  } else {
    await db
      .insertInto("docs")
      .values({
        workspaceUuid,
        siteUuid,
        key: BLUEPRINT_DOC_KEY,
        title: "Blueprint draft",
        content,
        source: "ai_extracted",
        status: "active",
      })
      .execute();
  }
}

export function updatePageStatus(
  blueprint: SiteBlueprint,
  slug: string,
  status: SiteBlueprint["build_plan"]["page_status"][string],
): SiteBlueprint {
  return {
    ...blueprint,
    build_plan: {
      ...blueprint.build_plan,
      page_status: {
        ...blueprint.build_plan.page_status,
        [slug]: status,
      },
      next_page:
        blueprint.build_plan.next_page === slug && status !== "in_progress"
          ? ""
          : blueprint.build_plan.next_page,
    },
  };
}

export function advanceNextPage(blueprint: SiteBlueprint): SiteBlueprint {
  const remaining = blueprint.build_plan.build_order.filter(
    (slug) => slug !== "index" && blueprint.build_plan.page_status[slug] === "planned",
  );
  return {
    ...blueprint,
    build_plan: {
      ...blueprint.build_plan,
      next_page: remaining[0] ?? "",
    },
  };
}

export function allBuiltSlugs(blueprint: SiteBlueprint): string[] {
  return blueprint.build_plan.build_order.filter(
    (slug) => blueprint.build_plan.page_status[slug] === "built" || slug === "index",
  );
}
