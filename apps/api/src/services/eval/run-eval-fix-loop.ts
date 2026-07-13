// apps/api/src/services/eval/run-eval-fix-loop.ts
// Shared eval-fix engine used by both the CLI stage and the API worker. It
// heals docs/content deterministically, rebuilds the Astro renderer locally,
// and re-evaluates until the page converges or we run out of loops.

import path from "node:path";
import type { GymSiteContent } from "@milo/shared-types";
import { buildFixPlan } from "./eval-fix.js";
import { evaluatePage } from "./page-evaluator.js";
import type { PageEvalReport } from "./page-eval-report.js";
import { loadSiteHierarchyDoc, saveSiteHierarchyDoc } from "../../utils/site-hierarchy-io.js";
import { loadDesignSystemDoc, saveDesignSystemDoc } from "../../utils/design-system-io.js";
import { buildGymJson } from "../template/content-mapper.js";
import { saveArtifact, loadArtifact } from "../../utils/pipeline/artifact-store.js";
import { withLocalDistServer } from "../../utils/serve-local-dist.js";
import { buildTemplateLocal } from "../template/deploy-template.js";
import type { Config } from "../../plugins/env";
import type { DB } from "../../types/db";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Kysely } from "kysely";

export interface EvalFixLoopInput {
  db: Kysely<DB>;
  config: Config;
  s3Client: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  rendererDir: string;
  report: PageEvalReport;
  /** Page path, e.g. "/" or "/about". */
  resolvedPath: string;
  /** Resolved page slug for the hierarchy lookup. */
  resolvedPageSlug: string;
  scoreThreshold?: number;
  maxLoops?: number;
  keywords?: string[];
  log?: (msg: string) => void;
  /** Theme override forwarded to the local Astro build. */
  templateTheme?: "baseline" | "impact" | "beanburito";
}

export interface EvalFixLoopOutput {
  /** The report after the last loop (or the original if no loop ran). */
  report: PageEvalReport;
  /** The content object after any heals (may be unchanged). */
  content: GymSiteContent | undefined;
  /** Number of heal/build/eval loops actually executed. */
  loops: number;
  /** Sum of deterministic heals applied across all loops. */
  appliedHeals: number;
  /** Sum of section instruction briefs generated across all loops. */
  sectionInstructions: number;
  /** True if a heal was applied in the final loop. */
  changed: boolean;
  /** Human-readable reason the loop exited. */
  convergedReason?: string;
}

function countCriticalIssues(report: PageEvalReport): number {
  return report.categories.flatMap((c) => c.issues).filter((i) => i.severity === "critical").length;
}

function buildReportMetrics(report: PageEvalReport) {
  const totalIssues = report.categories.flatMap((c) => c.issues).length;
  const criticalIssues = countCriticalIssues(report);
  return { totalIssues, criticalIssues, preScore: report.overall.score };
}

async function loadInitialContent(
  db: Kysely<DB>,
  siteUuid: string,
  workspaceUuid: string,
): Promise<GymSiteContent | undefined> {
  const generateArtifact = await loadArtifact<GymSiteContent>(
    db,
    { siteUuid, workspaceUuid },
    "generate" as unknown as Parameters<typeof loadArtifact>[2],
  );
  if (generateArtifact?.payload) {
    return generateArtifact.payload;
  }
  try {
    const { content: mapped } = await buildGymJson(
      db,
      siteUuid,
      { apiBaseUrl: "", siteUrl: "", workspaceUuid },
      workspaceUuid,
    );
    return mapped;
  } catch {
    // Tier 1 clone-only sites may not have mappable GymSiteContent.
    return undefined;
  }
}

/**
 * Run the deterministic heal → local build → local re-eval loop. Saves healed
 * docs/content back to the DB/artifact store after each successful heal.
 */
export async function runEvalFixLoop(input: EvalFixLoopInput): Promise<EvalFixLoopOutput> {
  const {
    db,
    config,
    s3Client,
    siteUuid,
    workspaceUuid,
    rendererDir,
    resolvedPath,
    resolvedPageSlug,
    scoreThreshold = 70,
    maxLoops = 10,
    keywords,
    log,
    templateTheme,
  } = input;

  const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
  if (!hierarchy) {
    throw new Error(`Site hierarchy not found for ${siteUuid}`);
  }

  const designSystemDoc = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
  if (!designSystemDoc || designSystemDoc.version !== "2") {
    throw new Error(`Design system v2 not found for site ${siteUuid}`);
  }

  let content = await loadInitialContent(db, siteUuid, workspaceUuid);
  let currentReport = input.report;
  let loop = 0;
  let totalAppliedHeals = 0;
  let totalSectionInstructions = 0;
  let lastChanged = false;
  let convergedReason: string | undefined;

  while (loop < maxLoops) {
    loop += 1;
    const loopStart = Date.now();
    const loopPreMetrics = buildReportMetrics(currentReport);

    log?.(
      `\n  Eval-fix loop ${loop}/${maxLoops} — score ${currentReport.overall.score}${currentReport.overall.grade}, ${loopPreMetrics.criticalIssues} critical, ${loopPreMetrics.totalIssues} issues`,
    );

    const plan = buildFixPlan({
      report: currentReport,
      content,
      hierarchy,
      designSystem: designSystemDoc,
      pageSlug: resolvedPageSlug,
    });

    if (!plan.changed) {
      convergedReason = "No deterministic heals applied and remaining issues need visual/interactivity edits.";
      log?.(`  ${convergedReason}`);
      break;
    }

    lastChanged = true;
    totalAppliedHeals += plan.brief.appliedHeals.length;
    totalSectionInstructions += plan.brief.sectionInstructions.length;

    await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, plan.hierarchy);
    await saveDesignSystemDoc(db, workspaceUuid, siteUuid, plan.designSystem);
    if (plan.content) {
      await saveArtifact(
        db,
        { siteUuid, workspaceUuid },
        "generate" as unknown as Parameters<typeof saveArtifact>[2],
        plan.content,
      );
      content = plan.content;
    }

    log?.(
      `  Applied ${plan.brief.appliedHeals.length} heals, ${plan.brief.sectionInstructions.length} section instructions — rebuilding locally...`,
    );
    await buildTemplateLocal({
      rendererDir,
      gymJson: content,
      siteUuid,
      workspaceUuid,
      templateTheme,
      log: {
        info: (o, m) => log?.(`  [build] ${m}`),
        warn: (o, m) => log?.(`  [warn] ${m}`),
      },
    });

    const distDir = path.join(rendererDir, "dist");
    const reEvalReport = await withLocalDistServer(distDir, async (localUrl) => {
      const reEvalUrl = `${localUrl}${resolvedPath.replace(/^\//, "")}`;
      return await evaluatePage({
        db,
        config,
        s3Client,
        siteUuid,
        workspaceUuid,
        path: resolvedPath,
        url: reEvalUrl,
        keywords,
        log: (msg) => log?.(`  [eval] ${msg}`),
      });
    });

    currentReport = reEvalReport;
    const loopPostMetrics = buildReportMetrics(reEvalReport);
    const improved =
      reEvalReport.overall.score > loopPreMetrics.preScore ||
      loopPostMetrics.criticalIssues < loopPreMetrics.criticalIssues ||
      loopPostMetrics.totalIssues < loopPreMetrics.totalIssues;

    log?.(
      `  Loop ${loop} result — score ${reEvalReport.overall.score}${reEvalReport.overall.grade}, ${loopPostMetrics.criticalIssues} critical, ${loopPostMetrics.totalIssues} issues (${Date.now() - loopStart}ms)`,
    );

    if (reEvalReport.overall.score >= scoreThreshold && loopPostMetrics.criticalIssues === 0) {
      convergedReason = `Score ${reEvalReport.overall.score} >= ${scoreThreshold} and 0 critical issues.`;
      log?.(`  Converged: ${convergedReason}`);
      break;
    }

    if (!improved) {
      convergedReason = "No measurable improvement this loop — stopping to avoid non-deterministic retries.";
      log?.(`  ${convergedReason}`);
      break;
    }
  }

  return {
    report: currentReport,
    content,
    loops: loop,
    appliedHeals: totalAppliedHeals,
    sectionInstructions: totalSectionInstructions,
    changed: lastChanged,
    convergedReason,
  };
}

export default runEvalFixLoop;
