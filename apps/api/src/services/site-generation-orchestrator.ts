import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { FastifyInstance } from "fastify";
import type { SiteSection } from "@ploy-gyms/shared-types";
import type { PageBuildStatus, SiteHierarchy, HierarchySection } from "../types/site-hierarchy";
import {
  loadSiteHierarchyDoc,
  saveSiteHierarchyDoc,
  updatePageStatus,
  advanceNextPage,
  pageBySlug,
  remainingPlannedSlugs,
} from "../utils/site-hierarchy-io";
import { loadDesignSystemDoc, saveDesignSystemDoc } from "../utils/design-system-io";
import { loadSectionVisualEvidenceDoc } from "../utils/section-visual-evidence-io";
import { resolveReferenceScreenshot } from "../utils/screenshot-assets";
import { getJobCostUsd } from "../utils/job-budget";
import { generateAstroPage, signS3AssetUrls } from "./astro-code-generator";
import { runPageQa, type QaIssue } from "./page-qa";
import { logAiActivity } from "./ai-activity";
import { jsonb } from "../utils/jsonb";
import type { DesignSystemV2 } from "../types/design-system-v2";
import type { SectionVisualEvidence } from "../types/section-visual-evidence";
import { renderVisualBlock } from "./visual-section-renderer";
import { renderSemanticSection } from "../utils/section-component-registry";
import { makeDefaultHeader, makeDefaultFooter } from "./astro-code-generator";

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

async function loadSiteAndHierarchy(db: Kysely<DB>, workspaceUuid: string, siteUuid: string) {
  const site = await db.selectFrom("sites").selectAll().where("uuid", "=", siteUuid).executeTakeFirst();
  if (!site) throw new Error(`Site ${siteUuid} not found`);
  if (site.workspaceUuid !== workspaceUuid) throw new Error("Site does not belong to workspace");

  const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
  if (!hierarchy) throw new Error(`Site hierarchy not found for site ${siteUuid}`);

  return { site, hierarchy };
}

async function loadDesignSystemV2(
  db: Kysely<DB>,
  workspaceUuid: string,
  siteUuid: string,
): Promise<DesignSystemV2> {
  const doc = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
  if (!doc) {
    throw new Error(`Design system not found for site ${siteUuid}`);
  }
  if (doc.version !== "2") {
    throw new Error(`Design system v${doc.version} is not supported; migration to v2 is required`);
  }
  return doc as DesignSystemV2;
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

function hierarchyHeroToSiteSection(section: HierarchySection): SiteSection {
  return {
    id: section.id,
    type: "Hero",
    props: {
      title: section.content.heading ?? "",
      subtitle: section.content.body ?? "",
      cta: section.content.cta ?? null,
      backgroundImage: section.content.images?.[0]?.url ?? null,
    },
  };
}

function getEvidenceForSection(
  visualEvidence: SectionVisualEvidence | null,
  section: HierarchySection,
): import("../types/section-visual-evidence").SectionVisualEvidenceRow | undefined {
  return visualEvidence?.rows.find((row) => row.evidenceId === section.evidenceId);
}

export async function startSiteBuild(input: StartSiteBuildInput): Promise<StartSiteBuildOutput> {
  const { db, queues, config, workspaceUuid, siteUuid, requestedMode, existingAiJobUuid } = input;
  const { site, hierarchy } = await loadSiteAndHierarchy(db, workspaceUuid, siteUuid);

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

  const designSystem = await loadDesignSystemV2(db, workspaceUuid, siteUuid);
  await saveDesignSystemDoc(db, workspaceUuid, siteUuid, designSystem);

  const referenceScreenshotUrl =
    mode === "replication" && site.sourceUrl
      ? (await resolveReferenceScreenshot(db, config, workspaceUuid, siteUuid, site.sourceUrl, "index"))?.url ?? null
      : null;

  const firstSlug = hierarchy.buildPlan.buildOrder[0] ?? "index";
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
  const { site, hierarchy } = await loadSiteAndHierarchy(db, workspaceUuid, siteUuid);
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

  const designSystem = await loadDesignSystemV2(db, workspaceUuid, siteUuid);
  const visualEvidence = await loadSectionVisualEvidenceDoc(db, workspaceUuid, siteUuid);

  const page = pageBySlug(hierarchy, pageSlug);
  if (!page) {
    throw new Error(`Page ${pageSlug} not found in site hierarchy`);
  }

  // Sign private S3 asset URLs before rendering so the generic visual block
  // renderer and semantic shell renderers receive usable image URLs.
  const signedDesignSystem = await signS3AssetUrls(designSystem, config);
  const signedPage = await signS3AssetUrls(page, config);
  const signedVisualEvidence = visualEvidence ? await signS3AssetUrls(visualEvidence, config) : visualEvidence;

  let currentHierarchy = updatePageStatus(hierarchy, pageSlug, "in_progress");
  await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, currentHierarchy);

  const renderedSections: { section: HierarchySection; source: string }[] = [];
  for (let i = 0; i < signedPage.sections.length; i++) {
    const section = signedPage.sections[i];
    if (!section) continue;
    const previousTag = signedPage.sections[i - 1]?.tag;
    const nextTag = signedPage.sections[i + 1]?.tag;

    if (section.tag === "header") {
      const headerSection = signedDesignSystem.global.shell.header ?? makeDefaultHeader(signedDesignSystem);
      renderedSections.push({ section, source: renderSemanticSection(headerSection) });
    } else if (section.tag === "footer") {
      const footerSection = signedDesignSystem.global.shell.footer ?? makeDefaultFooter(signedDesignSystem);
      renderedSections.push({ section, source: renderSemanticSection(footerSection) });
    } else if (section.tag === "hero") {
      renderedSections.push({ section, source: renderSemanticSection(hierarchyHeroToSiteSection(section)) });
    } else {
      const evidence = getEvidenceForSection(signedVisualEvidence, section);
      const source = await renderVisualBlock({
        section,
        evidence,
        designSystem: signedDesignSystem,
        previousTag,
        nextTag,
        config,
      });
      renderedSections.push({ section, source });
    }
  }

  const generated = await generateAstroPage({
    db,
    config,
    workspaceUuid,
    siteUuid,
    pageSlug,
    designSystem: signedDesignSystem,
    page: signedPage,
    renderedSections,
    mode: resolvedMode,
    attemptId,
  });

  if (!generated.buildSuccess) {
    await updatePageStatusAndLog(db, workspaceUuid, siteUuid, pageSlug, "planned", currentHierarchy, aiJobUuid, `Astro build failed for ${pageSlug}`, 0);
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
  currentHierarchy = updatePageStatus(currentHierarchy, pageSlug, status);
  currentHierarchy = advanceNextPage(currentHierarchy);
  await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, currentHierarchy);

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
  hierarchy: SiteHierarchy,
  aiJobUuid: string,
  summary: string,
  fidelityScore: number,
) {
  const updated = updatePageStatus(hierarchy, pageSlug, status);
  await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, updated);
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
  const { hierarchy } = await loadSiteAndHierarchy(db, workspaceUuid, siteUuid);

  if (hierarchy.buildPlan.pageStatus[pageSlug] !== "built") {
    throw new Error(`Page ${pageSlug} is not built yet and cannot be approved`);
  }

  const approvedHierarchy = updatePageStatus(hierarchy, pageSlug, "approved");
  await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, approvedHierarchy);

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

  const remaining = remainingPlannedSlugs(approvedHierarchy, pageSlug);
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

export interface ReSkinSiteInput extends Pick<OrchestratorContext, "db" | "queues" | "config" | "workspaceUuid" | "siteUuid" | "userUuid"> {
  designSystem: DesignSystemV2;
}

export async function reSkinSite(input: ReSkinSiteInput): Promise<{ enqueued: string[] }> {
  const { db, queues, workspaceUuid, siteUuid, userUuid, designSystem } = input;

  await saveDesignSystemDoc(db, workspaceUuid, siteUuid, designSystem);

  const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
  if (!hierarchy) {
    throw new Error(`Site hierarchy not found for site ${siteUuid}`);
  }

  const slugs = hierarchy.buildPlan.buildOrder.filter((slug) => {
    const status = hierarchy.buildPlan.pageStatus[slug];
    return status === "built" || status === "approved";
  });

  if (slugs.length === 0) {
    return { enqueued: [] };
  }

  const options = { accuracy: "accurate", mode: hierarchy.siteMetadata.mode, reskin: true };
  const aiJobUuid = await createParentAiJob(db, workspaceUuid, siteUuid, "replicate_site", options);

  for (const slug of slugs) {
    const attemptId = generateAttemptId();
    await queues.generatePage.queue.add("generate_page", {
      workspaceUuid,
      siteUuid,
      pageSlug: slug,
      aiJobUuid,
      attemptId,
      mode: hierarchy.siteMetadata.mode,
    });
  }

  await updateSiteMemory(db, workspaceUuid, siteUuid, {
    recentEdits: [`${new Date().toISOString()} - Re-skinned site with new design system by ${userUuid ?? "system"}`],
  });

  return { enqueued: slugs };
}
