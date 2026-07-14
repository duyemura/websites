// apps/api/src/services/eval/site-eval-persistence.ts
// Persist full-site and per-page QA results to the site_evals table.

import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { SiteEvalReport, PageEvalReport } from "./page-eval-report.js";

export interface SiteEvalRowSummary {
  path: string;
  score: number;
  grade: string;
  status: "passed" | "failed";
}

function buildPageSummaries(pages: PageEvalReport[]): SiteEvalRowSummary[] {
  return pages.map((p) => ({
    path: p.metadata.path,
    score: p.overall.score,
    grade: p.overall.grade,
    status: p.overall.status,
  }));
}

function buildWarnings(pages: PageEvalReport[]): string[] {
  return pages.flatMap((p) =>
    p.categories.flatMap((c) =>
      c.issues.map((i) => `${p.metadata.path}: [${c.name}] ${i.severity}: ${i.message}`),
    ),
  );
}

/**
 * Insert a site_evals row for a full-site evaluation run.
 * Returns the new eval uuid.
 */
export async function recordSiteEval(
  db: Kysely<DB>,
  siteUuid: string,
  workspaceUuid: string,
  report: SiteEvalReport,
  status: "passed" | "failed" = report.summary.failedPages === 0 ? "passed" : "failed",
): Promise<string> {
  const summaries = buildPageSummaries(report.pages);
  const warnings = buildWarnings(report.pages);

  const row = await db
    .insertInto("siteEvals")
    .values({
      siteUuid,
      workspaceUuid,
      status,
      pageCount: report.summary.totalPages,
      passCount: report.summary.passedPages,
      formStatus: `${report.summary.avgScore}/100 ${report.pages[0]?.overall.grade ?? ""}`,
      warnings: JSON.stringify(warnings),
      pages: JSON.stringify(summaries),
      report: JSON.stringify(report),
      failedReason:
        status === "failed" && report.summary.failedPages > 0
          ? `${report.summary.failedPages} of ${report.summary.totalPages} pages failed QA`
          : null,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();

  return row.uuid;
}

/**
 * Load a previously persisted full-site eval by uuid.
 */
export async function loadSiteEval(
  db: Kysely<DB>,
  evalUuid: string,
): Promise<{ report?: SiteEvalReport; pages: SiteEvalRowSummary[] } | undefined> {
  const row = await db
    .selectFrom("siteEvals")
    .select(["report", "pages"])
    .where("uuid", "=", evalUuid)
    .executeTakeFirst();
  if (!row) return undefined;
  const report =
    row.report && typeof row.report === "object" && Object.keys(row.report).length > 0
      ? (row.report as unknown as SiteEvalReport)
      : undefined;
  const pages = Array.isArray(row.pages) ? (row.pages as unknown as SiteEvalRowSummary[]) : [];
  return { report, pages };
}
