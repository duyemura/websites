import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { SiteHierarchy } from "../types/site-hierarchy";
import { BLUEPRINT_DOC_KEY } from "./blueprint-io";
import { migrateBlueprintToHierarchy } from "./site-hierarchy-migrate";
import type { SiteBlueprint } from "./site-blueprint";

export const SITE_HIERARCHY_DOC_KEY = "site-hierarchy";
export const SITE_HIERARCHY_DOC_TITLE = "Site hierarchy";
const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/;

function parseDocJson<T>(content: string): T | null {
  const match = content.match(JSON_FENCE_RE);
  const jsonText = match?.[1] ?? content;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}

export async function loadSiteHierarchyDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
): Promise<SiteHierarchy | null> {
  const doc = await db
    .selectFrom("docs")
    .select("content")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", SITE_HIERARCHY_DOC_KEY)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (doc?.content) {
    const parsed = parseDocJson<SiteHierarchy>(doc.content);
    if (parsed?.version === "1" && Array.isArray(parsed.pages)) return parsed;
  }

  // Backward compatibility: migrate a legacy blueprint-draft doc to the new
  // site-hierarchy + design-system v2 shape, persist it, and return it.
  const legacyDoc = await db
    .selectFrom("docs")
    .select("content")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", BLUEPRINT_DOC_KEY)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (!legacyDoc?.content) return null;

  const blueprint = parseDocJson<SiteBlueprint>(legacyDoc.content);
  if (!blueprint?.site_metadata || !Array.isArray(blueprint.pages)) return null;

  const { hierarchy, designSystem } = migrateBlueprintToHierarchy(blueprint);
  await db.transaction().execute(async (trx) => {
    await saveSiteHierarchyDoc(trx, workspaceUuid, siteUuid, hierarchy);
    await saveDesignSystemDocForMigration(trx, workspaceUuid, siteUuid, designSystem);
  });
  return hierarchy;
}

async function saveDesignSystemDocForMigration(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  designSystem: import("../types/design-system-v2").DesignSystemV2,
): Promise<void> {
  const existing = await db
    .selectFrom("docs")
    .select("uuid")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", "design-system")
    .where("status", "=", "active")
    .executeTakeFirst();

  const content = `# Design system\n\nThis doc holds the locked global design system used to build every page.\n\n## Design system\n\n\`\`\`json\n${JSON.stringify(designSystem, null, 2)}\n\`\`\`\n`;

  if (existing) {
    await db.updateTable("docs").set({ content, updatedAt: new Date() }).where("uuid", "=", existing.uuid).execute();
  } else {
    await db
      .insertInto("docs")
      .values({
        workspaceUuid,
        siteUuid,
        key: "design-system",
        title: "Design system",
        content,
        source: "ai_extracted",
        status: "active",
      })
      .execute();
  }
}

export async function saveSiteHierarchyDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  hierarchy: SiteHierarchy,
): Promise<void> {
  const content = `# Site hierarchy\n\nThis doc holds the current semantic page/section hierarchy for the site.\n\n## Site hierarchy\n\n\`\`\`json\n${JSON.stringify(hierarchy, null, 2)}\n\`\`\`\n`;
  const existing = await db
    .selectFrom("docs")
    .select("uuid")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", SITE_HIERARCHY_DOC_KEY)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (existing) {
    await db.updateTable("docs").set({ content, updatedAt: new Date() }).where("uuid", "=", existing.uuid).execute();
  } else {
    await db.insertInto("docs").values({
      workspaceUuid,
      siteUuid,
      key: SITE_HIERARCHY_DOC_KEY,
      title: SITE_HIERARCHY_DOC_TITLE,
      content,
      source: "ai_extracted",
      status: "active",
    }).execute();
  }
}

export function updatePageStatus(
  hierarchy: SiteHierarchy,
  slug: string,
  status: SiteHierarchy["buildPlan"]["pageStatus"][string],
): SiteHierarchy {
  return {
    ...hierarchy,
    buildPlan: {
      ...hierarchy.buildPlan,
      pageStatus: { ...hierarchy.buildPlan.pageStatus, [slug]: status },
      nextPage: hierarchy.buildPlan.nextPage === slug && status !== "in_progress" ? "" : hierarchy.buildPlan.nextPage,
    },
  };
}

export function advanceNextPage(hierarchy: SiteHierarchy): SiteHierarchy {
  const remaining = hierarchy.buildPlan.buildOrder.filter(
    (slug) => slug !== "index" && hierarchy.buildPlan.pageStatus[slug] === "planned",
  );
  return { ...hierarchy, buildPlan: { ...hierarchy.buildPlan, nextPage: remaining[0] ?? "" } };
}

export function pageBySlug(hierarchy: SiteHierarchy, slug: string) {
  return hierarchy.pages.find((p) => p.slug === slug);
}

export function remainingPlannedSlugs(hierarchy: SiteHierarchy, afterSlug: string): string[] {
  const index = hierarchy.buildPlan.buildOrder.indexOf(afterSlug);
  const start = index === -1 ? 0 : index + 1;
  return hierarchy.buildPlan.buildOrder.slice(start).filter(
    (slug) => hierarchy.buildPlan.pageStatus[slug] === "planned",
  );
}
