import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { FastifyInstance } from "fastify";
import type { SiteBlueprint, PageBuildStatus } from "../utils/site-blueprint";
import { loadBlueprintDoc, saveBlueprintDoc, updatePageStatus, pageBySlug, remainingPlannedSlugs } from "../utils/blueprint-io";
import { loadOrBuildDesignSystem, saveDesignSystemDoc } from "../utils/design-system-io";
import { resolveReferenceScreenshot } from "../utils/screenshot-assets";
import { getJobCostUsd } from "../utils/job-budget";
import { generateAstroPage } from "./astro-code-generator";
import { runPageQa, type QaIssue } from "./page-qa";
import { logAiActivity } from "./ai-activity";
import { jsonb } from "../utils/jsonb";

export interface OrchestratorContext {
  db: Kysely<DB>;
  queues: FastifyInstance["queues"];
  config: Config;
  workspaceUuid: string;
  siteUuid: string;
  userUuid?: string;
}

export interface StartSiteBuildInput extends OrchestratorContext {
  requestedMode?: SiteMode;
  accuracy?: "fast" | "balanced" | "accurate";
  maxQaIterations?: number;
  maxBudgetUsd?: number;
  fidelityThreshold?: number;
  existingAiJobUuid?: string;
}

export interface BuildPageInput extends OrchestratorContext {
  pageSlug: string;
  aiJobUuid: string;
  attemptId: string;
  mode?: SiteMode;
  referenceScreenshotUrl?: string | null;
}

export interface ApprovePageInput extends Pick<OrchestratorContext, "db" | "queues" | "workspaceUuid" | "siteUuid" | "userUuid"> {
  pageSlug: string;
}

export interface StartSiteBuildOutput {
  aiJobUuid: string;
  attemptId: string;
  status: "running";
}

export interface BuildPageOutput {
  pageSlug: string;
  passed: boolean;
  fidelityScore: number;
  issues: QaIssue[];
  previewUrl: string;
}

export interface ApprovePageOutput {
  approved: string;
  remainingPagesEnqueued: string[];
}

type SiteMode = "replication" | "template" | "greenfield";

interface AccuracyPreset {
  modelTasks: { code: "code" | "default" | "reasoning"; qa: "vision" | "default"; text: "default" | "cheap" };
  fidelityThreshold: number;
}

const ACCURACY_PRESETS = {
  fast: { modelTasks: { code: "default", qa: "default", text: "cheap" }, fidelityThreshold: 0.75 },
  balanced: { modelTasks: { code: "code", qa: "vision", text: "default" }, fidelityThreshold: 0.85 },
  accurate: { modelTasks: { code: "reasoning", qa: "vision", text: "default" }, fidelityThreshold: 0.92 },
} as const satisfies Record<string, AccuracyPreset>;

function resolvePreset(accuracy?: string): AccuracyPreset {
  const key = accuracy as keyof typeof ACCURACY_PRESETS;
  return ACCURACY_PRESETS[key] ?? ACCURACY_PRESETS.accurate;
}

function generateAttemptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadSiteAndBlueprint(db: Kysely<DB>, workspaceUuid: string, siteUuid: string) {
  const site = await db.selectFrom("sites").selectAll().where("uuid", "=", siteUuid).executeTakeFirst();
  if (!site) throw new Error(`Site ${siteUuid} not found`);
  if (site.workspaceUuid !== workspaceUuid) throw new Error("Site does not belong to workspace");

  const blueprint = await loadBlueprintDoc(db, workspaceUuid, siteUuid);
  if (!blueprint) throw new Error(`Blueprint draft not found for site ${siteUuid}`);

  return { site, blueprint };
}

async function updateAiJobState(
  db: Kysely<DB>,
  aiJobUuid: string,
  patch: { state?: Record<string, unknown>; steps?: Record<string, unknown>[]; status?: "pending" | "running" | "completed" | "failed" | "cancelled" },
) {
  await db
    .updateTable("aiJobs")
    .set({
      ...(patch.state ? { state: jsonb(patch.state) } : {}),
      ...(patch.steps ? { steps: jsonb(patch.steps) } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where("uuid", "=", aiJobUuid)
    .execute();
}

async function updateSiteMemory(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  updates: { replicationStatus?: string; qaIssues?: string[]; recentEdits?: string[] },
) {
  const doc = await db
    .selectFrom("docs")
    .select("content")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", "site-memory")
    .executeTakeFirst();

  let content = doc?.content ?? `# Site Memory\n\nSite-specific iteration log and state.`;

  if (updates.replicationStatus) {
    content = content.replace(/## Replication status\n\n- .*/, `## Replication status\n\n- ${updates.replicationStatus}`);
    if (!content.includes("## Replication status")) {
      content += `\n\n## Replication status\n\n- ${updates.replicationStatus}`;
    }
  }

  if (updates.qaIssues && updates.qaIssues.length > 0) {
    const issuesBlock = `\n\n## QA issues\n\n${updates.qaIssues.map((i) => `- ${i}`).join("\n")}`;
    if (content.includes("## QA issues")) {
      content = content.replace(/## QA issues\n\n[\s\S]*?(?=\n## |$)/, issuesBlock.trim());
    } else {
      content += issuesBlock;
    }
  }

  if (updates.recentEdits && updates.recentEdits.length > 0) {
    const editsBlock = `\n\n## Recent edits\n\n${updates.recentEdits.map((e) => `- ${e}`).join("\n")}`;
    if (content.includes("## Recent edits")) {
      content = content.replace(/## Recent edits\n\n[\s\S]*?(?=\n## |$)/, editsBlock.trim());
    } else {
      content += editsBlock;
    }
  }

  const existing = await db
    .selectFrom("docs")
    .select("uuid")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", "site-memory")
    .executeTakeFirst();

  if (existing) {
    await db.updateTable("docs").set({ content, updatedAt: new Date() }).where("uuid", "=", existing.uuid).execute();
  } else {
    await db
      .insertInto("docs")
      .values({
        workspaceUuid,
        siteUuid,
        key: "site-memory",
        title: "Site memory",
        content,
        source: "ai_extracted",
        status: "active",
      })
      .execute();
  }
}

async function createParentAiJob(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  type: DB["aiJobs"]["type"],
  options: Record<string, unknown>,
): Promise<string> {
  const row = await db
    .insertInto("aiJobs")
    .values({
      workspaceUuid,
      siteUuid,
      type,
      status: "running",
      input: jsonb({ siteUuid, workspaceUuid, options }),
      state: jsonb({ phase: "design_system", currentSlug: "index" }),
      steps: jsonb([{ name: "build_homepage", status: "in_progress" }]),
      options: jsonb(options),
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return row.uuid;
}

export async function startSiteBuild(input: StartSiteBuildInput): Promise<StartSiteBuildOutput> {
  const { db, queues, config, workspaceUuid, siteUuid, requestedMode, existingAiJobUuid } = input;
  const { site, blueprint } = await loadSiteAndBlueprint(db, workspaceUuid, siteUuid);

  const mode = requestedMode ?? (site.mode as SiteMode);
  const preset = resolvePreset(input.accuracy);
  const options = {
    accuracy: input.accuracy ?? "accurate",
    maxBudgetUsd: input.maxBudgetUsd,
    fidelityThreshold: input.fidelityThreshold ?? preset.fidelityThreshold,
  };

  let aiJobUuid: string;
  if (existingAiJobUuid) {
    const existingJob = await db
      .selectFrom("aiJobs")
      .selectAll()
      .where("uuid", "=", existingAiJobUuid)
      .executeTakeFirst();
    if (!existingJob || existingJob.workspaceUuid !== workspaceUuid || existingJob.siteUuid !== siteUuid || existingJob.type !== "replicate_site") {
      throw new Error(`Cannot reuse aiJob ${existingAiJobUuid}: not found or does not belong to this site/workspace`);
    }
    aiJobUuid = existingAiJobUuid;
    await db
      .updateTable("aiJobs")
      .set({
        status: "running",
        state: jsonb({ phase: "design_system", currentSlug: "index" }),
        steps: jsonb([{ name: "build_homepage", status: "in_progress" }]),
        options: jsonb(options),
        updatedAt: new Date(),
      })
      .where("uuid", "=", existingAiJobUuid)
      .execute();
  } else {
    aiJobUuid = await createParentAiJob(db, workspaceUuid, siteUuid, "replicate_site", options);
  }

  const referenceScreenshotUrl =
    mode === "replication" && site.sourceUrl
      ? (await resolveReferenceScreenshot(db, config, workspaceUuid, siteUuid, site.sourceUrl, "index"))?.url ?? null
      : null;

  const designSystem = await loadOrBuildDesignSystem(db, config, workspaceUuid, siteUuid, mode, blueprint, referenceScreenshotUrl, true);
  await saveDesignSystemDoc(db, workspaceUuid, siteUuid, designSystem);

  const firstSlug = blueprint.build_plan.build_order[0] ?? "index";
  const attemptId = generateAttemptId();
  await queues.generatePage.queue.add("generate_page", {
    workspaceUuid,
    siteUuid,
    pageSlug: firstSlug,
    aiJobUuid,
    attemptId,
    mode,
    referenceScreenshotUrl,
  });

  await updateSiteMemory(db, workspaceUuid, siteUuid, {
    replicationStatus: `Build started (${mode}). Design system locked; ${firstSlug} queued with accuracy=${options.accuracy}.`,
  });

  return { aiJobUuid, attemptId, status: "running" };
}

export async function buildPage(input: BuildPageInput): Promise<BuildPageOutput> {
  const { db, config, workspaceUuid, siteUuid, pageSlug, aiJobUuid, attemptId, mode, referenceScreenshotUrl } = input;
  const { site, blueprint } = await loadSiteAndBlueprint(db, workspaceUuid, siteUuid);
  const resolvedMode = mode ?? (site.mode as SiteMode);
  const resolvedReferenceUrl =
    referenceScreenshotUrl ??
    (resolvedMode === "replication" && site.sourceUrl
      ? (await resolveReferenceScreenshot(db, config, workspaceUuid, siteUuid, site.sourceUrl, pageSlug))?.url ?? null
      : null);

  const parentJob = await db.selectFrom("aiJobs").select("options").where("uuid", "=", aiJobUuid).executeTakeFirst();
  const options = (parentJob?.options ?? {}) as { accuracy?: string; maxBudgetUsd?: number; fidelityThreshold?: number };
  const preset = resolvePreset(options.accuracy);
  const fidelityThreshold = options.fidelityThreshold ?? preset.fidelityThreshold;

  const designSystem = await loadOrBuildDesignSystem(db, config, workspaceUuid, siteUuid, resolvedMode, blueprint, resolvedReferenceUrl);
  if (!designSystem) {
    throw new Error(`Design system not available for site ${siteUuid}`);
  }

  const page = pageBySlug(blueprint, pageSlug);
  if (!page) {
    throw new Error(`Page ${pageSlug} not found in blueprint`);
  }

  let currentBlueprint = updatePageStatus(blueprint, pageSlug, "in_progress");
  await saveBlueprintDoc(db, workspaceUuid, siteUuid, currentBlueprint);

  const generated = await generateAstroPage({
    db,
    config,
    workspaceUuid,
    siteUuid,
    pageSlug,
    designSystem,
    page,
    mode: resolvedMode,
    attemptId,
  });

  if (!generated.buildSuccess) {
    await updatePageStatusAndLog(db, workspaceUuid, siteUuid, pageSlug, "planned", currentBlueprint, aiJobUuid, `Astro build failed for ${pageSlug}`, 0);
    throw new Error(`Astro build failed for ${pageSlug}: ${generated.buildLog ?? "unknown error"}`);
  }

  const qa = await runPageQa({
    db,
    config,
    workspaceUuid,
    siteUuid,
    pageSlug,
    aiJobUuid,
    distDir: generated.distDir,
    previewUrl: generated.previewUrl,
    referenceScreenshotUrl: resolvedReferenceUrl,
    mode: resolvedMode,
    fidelityThreshold,
  });

  const passed = qa.passed;
  const status: PageBuildStatus = passed ? "built" : "planned";
  currentBlueprint = updatePageStatus(currentBlueprint, pageSlug, status);
  await saveBlueprintDoc(db, workspaceUuid, siteUuid, currentBlueprint);

  const existingPage = await db.selectFrom("pages").select("uuid").where("siteUuid", "=", siteUuid).where("slug", "=", pageSlug).executeTakeFirst();
  if (existingPage) {
    await db
      .updateTable("pages")
      .set({
        title: generated.metaTitle,
        metaTitle: generated.metaTitle,
        metaDescription: generated.metaDescription,
        sections: jsonb(generated.pageSections),
        status: "draft",
        updatedAt: new Date(),
      })
      .where("uuid", "=", existingPage.uuid)
      .execute();
  } else {
    await db
      .insertInto("pages")
      .values({
        siteUuid,
        title: generated.metaTitle,
        slug: pageSlug,
        isHomePage: pageSlug === "index",
        metaTitle: generated.metaTitle,
        metaDescription: generated.metaDescription,
        sections: jsonb(generated.pageSections),
        status: "draft",
      })
      .execute();
  }

  if (pageSlug === "index") {
    await db
      .insertInto("deployments")
      .values({
        siteUuid,
        buildId: attemptId,
        status: passed ? "success" : "failed",
        artifactUrl: generated.previewUrl,
        previewUrl: generated.previewUrl,
        metadata: jsonb({
          mode: resolvedMode,
          fidelityScore: qa.fidelityScore,
          issues: qa.issues,
          s3: generated.s3,
        }),
      })
      .execute();
  }

  const costSoFar = await getJobCostUsd(db, aiJobUuid);
  await updateAiJobState(db, aiJobUuid, {
    state: { phase: "review", currentSlug: pageSlug, homepageBuilt: pageSlug === "index", costSoFar },
    steps: [{ name: `build_${pageSlug}`, status: passed ? "completed" : "failed" }],
  });

  await updateSiteMemory(db, workspaceUuid, siteUuid, {
    replicationStatus: `${pageSlug} ${passed ? "built" : "needs review"} (fidelity ${qa.fidelityScore.toFixed(2)}).`,
    qaIssues: qa.issues.map((i: QaIssue) => `[${i.severity}] ${i.component_id}: ${i.description}`),
    recentEdits: [`${new Date().toISOString()} - ${pageSlug} generated (attempt ${attemptId})`],
  });

  await logAiActivity(db, {
    workspaceUuid,
    userUuid: input.userUuid ?? "system",
    siteUuid,
    aiJobUuid,
    actionType: "generate",
    model: null,
    provider: config.LLM_PROVIDER,
    promptTemplateKeys: ["site-build-summary"],
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    outcome: passed ? "success" : "partial",
    fidelityScore: qa.fidelityScore,
    summary: `Built ${pageSlug} with single-pass QA. Fidelity ${qa.fidelityScore.toFixed(2)}. Issues: ${qa.issues.length}.`,
    metadata: { pageSlug, attemptId, mode: resolvedMode, passed, issueCount: qa.issues.length },
  });

  return { pageSlug, passed, fidelityScore: qa.fidelityScore, issues: qa.issues, previewUrl: generated.previewUrl };
}

async function updatePageStatusAndLog(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
  pageSlug: string,
  status: PageBuildStatus,
  blueprint: SiteBlueprint,
  aiJobUuid: string,
  summary: string,
  fidelityScore: number,
) {
  const updated = updatePageStatus(blueprint, pageSlug, status);
  await saveBlueprintDoc(db, workspaceUuid, siteUuid, updated);
  await updateAiJobState(db, aiJobUuid, { state: { phase: "failed", currentSlug: pageSlug }, steps: [{ name: `build_${pageSlug}`, status: "failed" }] });
  await logAiActivity(db, {
    workspaceUuid,
    userUuid: "system",
    siteUuid,
    aiJobUuid,
    actionType: "generate",
    outcome: "failure",
    fidelityScore,
    summary,
  });
}

export async function approvePage(input: ApprovePageInput): Promise<ApprovePageOutput> {
  const { db, queues, workspaceUuid, siteUuid, pageSlug, userUuid } = input;
  const { blueprint } = await loadSiteAndBlueprint(db, workspaceUuid, siteUuid);

  if (blueprint.build_plan.page_status[pageSlug] !== "built") {
    throw new Error(`Page ${pageSlug} is not built yet and cannot be approved`);
  }

  const approvedBlueprint = updatePageStatus(blueprint, pageSlug, "approved");
  await saveBlueprintDoc(db, workspaceUuid, siteUuid, approvedBlueprint);

  const parentJob = await db
    .selectFrom("aiJobs")
    .select("uuid")
    .where("siteUuid", "=", siteUuid)
    .where("status", "in", ["running", "completed"])
    .orderBy("createdAt", "desc")
    .executeTakeFirst();
  if (!parentJob) {
    throw new Error(`No running or completed site build job found for ${siteUuid}`);
  }
  const aiJobUuid = parentJob.uuid;

  const remaining = remainingPlannedSlugs(approvedBlueprint, pageSlug);
  for (const slug of remaining) {
    const attemptId = generateAttemptId();
    await queues.generatePage.queue.add("generate_page", {
      workspaceUuid,
      siteUuid,
      pageSlug: slug,
      aiJobUuid,
      attemptId,
    });
  }

  await updateSiteMemory(db, workspaceUuid, siteUuid, {
    replicationStatus: `${pageSlug} approved. ${remaining.length} remaining page(s) queued for build.`,
    recentEdits: [`${new Date().toISOString()} - ${pageSlug} approved by ${userUuid ?? "system"}`],
  });

  return { approved: pageSlug, remainingPagesEnqueued: remaining };
}
