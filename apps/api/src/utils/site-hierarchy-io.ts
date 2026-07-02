import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { SiteHierarchy } from "../types/site-hierarchy";

const SITE_HIERARCHY_DOC_KEY = "site-hierarchy";
const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/;

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

  if (!doc?.content) return null;
  const match = doc.content.match(JSON_FENCE_RE);
  const jsonText = match?.[1] ?? doc.content;
  try {
    return JSON.parse(jsonText) as SiteHierarchy;
  } catch {
    return null;
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
    .executeTakeFirst();

  if (existing) {
    await db.updateTable("docs").set({ content, updatedAt: new Date() }).where("uuid", "=", existing.uuid).execute();
  } else {
    await db.insertInto("docs").values({
      workspaceUuid,
      siteUuid,
      key: SITE_HIERARCHY_DOC_KEY,
      title: "Site hierarchy",
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
