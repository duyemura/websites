import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { SiteBlueprint } from "./site-blueprint";
import { loadBlueprintDoc } from "./blueprint-io";
import { buildDesignSystem, type DesignSystem } from "./design-system";

const DESIGN_SYSTEM_DOC_KEY = "design-system";
const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/;

export async function loadDesignSystemDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
): Promise<DesignSystem | null> {
  const doc = await db
    .selectFrom("docs")
    .select("content")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", DESIGN_SYSTEM_DOC_KEY)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (!doc?.content) return null;

  const match = doc.content.match(JSON_FENCE_RE);
  const jsonText = match?.[1] ?? doc.content;
  try {
    const parsed = JSON.parse(jsonText) as DesignSystem;
    if (parsed.version !== "1") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveDesignSystemDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  designSystem: DesignSystem,
): Promise<void> {
  const content = `# Design system

This doc holds the locked global design system used to build every page in the site.

## Design system

\`\`\`json
${JSON.stringify(designSystem, null, 2)}
\`\`\`
`;

  const existing = await db
    .selectFrom("docs")
    .select("uuid")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", DESIGN_SYSTEM_DOC_KEY)
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
        key: DESIGN_SYSTEM_DOC_KEY,
        title: "Design system",
        content,
        source: "ai_extracted",
        status: "active",
      })
      .execute();
  }
}

export async function loadOrBuildDesignSystem(
  db: Kysely<DB>,
  _config: Config,
  workspaceUuid: string,
  siteUuid: string,
  _mode: "replication" | "template" | "greenfield",
  fallbackBlueprint?: SiteBlueprint,
  referenceScreenshotUrl?: string | null,
  force = false,
): Promise<DesignSystem> {
  if (!force) {
    const existing = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
    if (existing) return existing;
  }

  const blueprint = fallbackBlueprint ?? (await loadBlueprintDoc(db, workspaceUuid, siteUuid));
  if (!blueprint) {
    throw new Error(`No design-system doc or blueprint found for site ${siteUuid}`);
  }

  const brand = blueprint.brand_identity;
  const homePage = blueprint.pages.find((p) => p.isHomePage);
  return buildDesignSystem({
    blueprint,
    brand: brand
      ? {
          logo: brand.logo,
          headingStyle: brand.heading_style,
        }
      : undefined,
    referenceScreenshotUrl,
    sectionOrder: blueprint.reference?.section_order,
    homePagePrimaryCta: homePage?.primaryCta,
  });
}
