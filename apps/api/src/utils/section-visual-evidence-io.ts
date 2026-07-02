import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { SectionVisualEvidence } from "../types/section-visual-evidence";

const SECTION_VISUAL_EVIDENCE_DOC_KEY = "section-visual-evidence";
const JSON_FENCE_RE = /```json\n([\s\S]*?)\n```/;

export async function loadSectionVisualEvidenceDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
): Promise<SectionVisualEvidence | null> {
  const doc = await db
    .selectFrom("docs")
    .select("content")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", SECTION_VISUAL_EVIDENCE_DOC_KEY)
    .where("status", "=", "active")
    .executeTakeFirst();

  if (!doc?.content) return null;
  const match = doc.content.match(JSON_FENCE_RE);
  const jsonText = match?.[1] ?? doc.content;
  try {
    return JSON.parse(jsonText) as SectionVisualEvidence;
  } catch {
    return null;
  }
}

export async function saveSectionVisualEvidenceDoc(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  evidence: SectionVisualEvidence,
): Promise<void> {
  const content = `# Section visual evidence\n\nThis doc holds per-section screenshots, computed styles, and DOM snippets used by the generic visual block renderer.\n\n## Section visual evidence\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`;
  const existing = await db
    .selectFrom("docs")
    .select("uuid")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", SECTION_VISUAL_EVIDENCE_DOC_KEY)
    .executeTakeFirst();

  if (existing) {
    await db.updateTable("docs").set({ content, updatedAt: new Date() }).where("uuid", "=", existing.uuid).execute();
  } else {
    await db.insertInto("docs").values({
      workspaceUuid,
      siteUuid,
      key: SECTION_VISUAL_EVIDENCE_DOC_KEY,
      title: "Section visual evidence",
      content,
      source: "ai_extracted",
      status: "active",
    }).execute();
  }
}
