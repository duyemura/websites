import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { FastifyInstance } from "fastify";
import type { SiteBlueprint, PageBuildStatus } from "../utils/site-blueprint";
import { loadBlueprintDoc, saveBlueprintDoc, updatePageStatus } from "../utils/blueprint-io";
import { resolveReferenceScreenshot } from "../utils/screenshot-assets";
import { getJobCostUsd } from "../utils/job-budget";
import { generateAstroPage, type QaIssue } from "./astro-code-generator";
import { runRalphLoop } from "./ralph-loop";
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
  requestedMode?: "replication" | "template" | "greenfield";
  accuracy?: "fast" | "balanced" | "accurate";
  maxQaIterations?: number;
  maxBudgetUsd?: number;
  fidelityThreshold?: number;
}

export interface BuildPageInput extends OrchestratorContext {
  pageSlug: string;
  aiJobUuid: string;
  attemptId: string;
}

export interface ApprovePageInput extends Pick<OrchestratorContext, "db" | "queues" | "workspaceUuid" | "siteUuid" | "userUuid"> {
  pageSlug: string;
}

interface AccuracyPreset {
  modelTasks: { code: "code" | "default" | "reasoning"; qa: "vision" | "default"; text: "default" | "cheap" };
  maxQaIterations: number;
  fidelityThreshold: number;
}

const ACCURACY_PRESETS: Record<string, AccuracyPreset> = {
  fast: { modelTasks: { code: "default", qa: "default", text: "cheap" }, maxQaIterations: 1, fidelityThreshold: 0.75 },
  balanced: { modelTasks: { code: "code", qa: "vision", text: "default" }, maxQaIterations: 2, fidelityThreshold: 0.85 },
  accurate: { modelTasks: { code: "reasoning", qa: "vision", text: "default" }, maxQaIterations: 4, fidelityThreshold: 0.92 },
};

function resolvePreset(accuracy?: string): AccuracyPreset {
  return ACCURACY_PRESETS[accuracy ?? "accurate"]!;
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

  const docs = await db
    .selectFrom("docs")
    .selectAll()
    .where("workspaceUuid", "=", workspaceUuid)
    .where((eb) => eb.or([eb("siteUuid", "is", null), eb("siteUuid", "=", siteUuid)]))
    .where("status", "=", "active")
    .where("key", "in", ["workspace-memory", "site-memory", "brand-guidelines", "business-info", "site-strategy", "blueprint-draft"])
    .execute();

  return { site, blueprint, docs };
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
      content = content.replace(/## QA issues\n\n[\\s\\S]*?(?=\n## |$)/, issuesBlock.trim());
    } else {
      content += issuesBlock;
    }
  }

  if (updates.recentEdits && updates.recentEdits.length > 0) {
    const editsBlock = `\n\n## Recent edits\n\n${updates.recentEdits.map((e) => `- ${e}`).join("\n")}`;
    if (content.includes("## Recent edits")) {
      content = content.replace(/## Recent edits\n\n[\\s\\S]*?(?=\n## |$)/, editsBlock.trim());
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
  _userUuid?: string,
) {
  const row = await db
    .insertInto("aiJobs")
    .values({
      workspaceUuid,
      siteUuid,
      type,
      status: "running",
      input: jsonb({ siteUuid, workspaceUuid, options }),
      state: jsonb({ phase: "build", currentSlug: "index" }),
      steps: jsonb([{ name: "build_homepage", status: "in_progress" }]),
      options: jsonb(options),
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return row.uuid;
}

export async function startSiteBuild(input: StartSiteBuildInput) {
  const { db, queues, workspaceUuid, siteUuid, requestedMode, userUuid } = input;
  const { site } = await loadSiteAndBlueprint(db, workspaceUuid, siteUuid);

  const mode = requestedMode ?? (site.mode as SiteMode);
  const preset = resolvePreset(input.accuracy);
  const options = {
    accuracy: input.accuracy ?? "accurate",
    maxQaIterations: input.maxQaIterations ?? preset.maxQaIterations,
    maxBudgetUsd: input.maxBudgetUsd,
    fidelityThreshold: input.fidelityThreshold ?? preset.fidelityThreshold,
  };

  const aiJobUuid = await createParentAiJob(db, workspaceUuid, siteUuid, "replicate_site", options, userUuid);

  const attemptId = generateAttemptId();
  await queues.generatePage.queue.add("generate_page", {
    workspaceUuid,
    siteUuid,
    pageSlug: "index",
    aiJobUuid,
    attemptId,
  });

  await updateSiteMemory(db, workspaceUuid, siteUuid, {
    replicationStatus: `Build started (${mode}). Homepage queued with accuracy=${options.accuracy}.`,
  });

  return { aiJobUuid, attemptId, status: "running" };
}

type SiteMode = "replication" | "template" | "greenfield";

export async function buildPage(input: BuildPageInput) {
  const { db, config, workspaceUuid, siteUuid, pageSlug, aiJobUuid, attemptId } = input;
  const { site, blueprint } = await loadSiteAndBlueprint(db, workspaceUuid, siteUuid);
  const mode = site.mode as SiteMode;

  const parentJob = await db.selectFrom("aiJobs").select("options").where("uuid", "=", aiJobUuid).executeTakeFirst();
  const options = (parentJob?.options ?? {}) as { accuracy?: string; maxQaIterations?: number; maxBudgetUsd?: number; fidelityThreshold?: number };
  const preset = resolvePreset(options.accuracy);
  const maxQaIterations = options.maxQaIterations ?? preset.maxQaIterations;
  const fidelityThreshold = options.fidelityThreshold ?? preset.fidelityThreshold;
  const maxBudgetUsd = options.maxBudgetUsd;

  const referenceScreenshotUrl =
    mode === "replication" && site.sourceUrl
      ? await resolveReferenceScreenshot(db, config, workspaceUuid, siteUuid, site.sourceUrl, pageSlug)
      : null;

  const priorIssues: QaIssue[] = [];
  let currentBlueprint = updatePageStatus(blueprint, pageSlug, "in_progress");
  await saveBlueprintDoc(db, workspaceUuid, siteUuid, currentBlueprint);

  const generated = await generateAstroPage({
    db,
    config,
    workspaceUuid,
    siteUuid,
    pageSlug,
    blueprint: currentBlueprint,
    mode,
    attemptId,
    priorIssues,
  });

  if (!generated.buildSuccess) {
    await updatePageStatusAndLog(db, workspaceUuid, siteUuid, pageSlug, "planned", currentBlueprint, aiJobUuid, "Page build failed", 0);
    throw new Error(`Astro build failed for ${pageSlug}: ${generated.buildLog ?? "unknown error"}`);
  }

  const ralph = await runRalphLoop({
    db,
    config,
    workspaceUuid,
    siteUuid,
    pageSlug,
    aiJobUuid,
    distDir: generated.distDir,
    referenceScreenshotUrl: referenceScreenshotUrl?.url ?? null,
    mode,
    maxIterations: maxQaIterations,
    fidelityThreshold,
    maxBudgetUsd,
    blueprint,
    attemptId,
  });

  const passed = ralph.passed;
  const status: PageBuildStatus = passed ? "built" : "planned";
  currentBlueprint = updatePageStatus(currentBlueprint, pageSlug, status);
  await saveBlueprintDoc(db, workspaceUuid, siteUuid, currentBlueprint);

  const page = await db.selectFrom("pages").select("uuid").where("siteUuid", "=", siteUuid).where("slug", "=", pageSlug).executeTakeFirst();
  if (page) {
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
      .where("uuid", "=", page.uuid)
      .execute();
  }

  const finalPreviewUrl = ralph.previewUrl ?? generated.previewUrl;
  if (pageSlug === "index") {
    await db
      .insertInto("deployments")
      .values({
        siteUuid,
        buildId: attemptId,
        status: passed ? "success" : "failed",
        artifactUrl: finalPreviewUrl,
        previewUrl: finalPreviewUrl,
        metadata: jsonb({ mode, fidelityScore: ralph.fidelityScore, issues: ralph.issues }),
      })
      .execute();
  }

  const costSoFar = await getJobCostUsd(db, aiJobUuid);
  await updateAiJobState(db, aiJobUuid, {
    state: { phase: "review", currentSlug: pageSlug, homepageBuilt: pageSlug === "index", costSoFar },
    steps: [{ name: `build_${pageSlug}`, status: passed ? "completed" : "failed" }],
  });

  await updateSiteMemory(db, workspaceUuid, siteUuid, {
    replicationStatus: `${pageSlug} ${passed ? "built" : "needs review"} (fidelity ${ralph.fidelityScore.toFixed(2)}).`,
    qaIssues: ralph.issues.map((i) => `[${i.severity}] ${i.component_id}: ${i.description}`),
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
    fidelityScore: ralph.fidelityScore,
    summary: `Built ${pageSlug} with ${ralph.iterations} QA iterations. Fidelity ${ralph.fidelityScore.toFixed(2)}. Issues: ${ralph.issues.length}.`,
    metadata: { pageSlug, attemptId, mode, passed, issueCount: ralph.issues.length },
  });

  return { pageSlug, passed, fidelityScore: ralph.fidelityScore, issues: ralph.issues, previewUrl: finalPreviewUrl };
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

export async function approvePage(input: ApprovePageInput) {
  const { db, queues, workspaceUuid, siteUuid, pageSlug, userUuid } = input;
  const { blueprint } = await loadSiteAndBlueprint(db, workspaceUuid, siteUuid);

  if (blueprint.build_plan.page_status[pageSlug] !== "built") {
    throw new Error(`Page ${pageSlug} is not built yet and cannot be approved`);
  }

  const approvedBlueprint = updatePageStatus(blueprint, pageSlug, "approved");
  await saveBlueprintDoc(db, workspaceUuid, siteUuid, approvedBlueprint);

  if (pageSlug === "index") {
    const remaining = approvedBlueprint.build_plan.build_order.filter(
      (slug) => slug !== "index" && approvedBlueprint.build_plan.page_status[slug] === "planned",
    );
    for (const slug of remaining) {
      const attemptId = generateAttemptId();
      await queues.generatePage.queue.add("generate_page", {
        workspaceUuid,
        siteUuid,
        pageSlug: slug,
        aiJobUuid: (await db.selectFrom("aiJobs").select("uuid").where("siteUuid", "=", siteUuid).orderBy("createdAt", "desc").executeTakeFirst())?.uuid ?? "",
        attemptId,
      });
    }
  }

  await updateSiteMemory(db, workspaceUuid, siteUuid, {
    replicationStatus: `${pageSlug} approved. Remaining pages queued for build.`,
    recentEdits: [`${new Date().toISOString()} - ${pageSlug} approved by ${userUuid ?? "system"}`],
  });

  return { approved: pageSlug, remainingPagesEnqueued: pageSlug === "index" ? approvedBlueprint.build_plan.build_order.filter((s) => s !== "index" && approvedBlueprint.build_plan.page_status[s] === "planned") : [] };
}
