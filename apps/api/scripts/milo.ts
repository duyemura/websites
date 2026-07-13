// apps/api/scripts/milo.ts
// Must be first — loads apps/api/.env (DB_PORT=5434 etc.) before database module initializes,
// then overlays the workspace root .env so shared secrets like GOOGLE_PLACES_API_KEY are available.
import "dotenv/config";
import "./load-root-env.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { db, config } from "../src/database";
import { getS3Client } from "../src/s3";
import { loadArtifact } from "../src/utils/pipeline/artifact-store";
import type { StageRunner, StageResult, StageContext } from "./stages/types";
import { dedupeWarnings } from "./stages/types";
import type { PipelineStage } from "../src/types/pipeline-artifacts";
import { parseArgs, PIPELINES } from "./milo-args.js";
import type { MiloCommand } from "./milo-args.js";
import { perPageEvalStage } from "./stages/per-page-eval.js";
import { evalFixStage } from "./stages/eval-fix.js";
export type { MiloCommand } from "./milo-args.js";

async function loadRegistry(): Promise<Record<string, StageRunner>> {
  // Lazy: only attempt to load stages that exist
  const registry: Record<string, StageRunner> = {};
  const stageModules: [string, string][] = [
    ["enrich", "./stages/enrich.js"],
    ["crawl", "./stages/crawl.js"],
    ["eval", "./stages/eval.js"],
    ["eval-fix", "./stages/eval-fix.js"],
    ["docgen", "./stages/docgen.js"],
    ["content", "./stages/content.js"],
    ["generate", "./stages/generate.js"],
    ["nav-rebuild", "./stages/nav-rebuild.js"],
    ["template", "./stages/template.js"],
    ["template-eval", "./stages/template-eval.js"],
    ["publish", "./stages/publish.js"],
    ["restore", "./stages/restore.js"],
  ];
  for (const [name, path] of stageModules) {
    try {
      const mod = await import(path);
      const exportName =
        name === "template-eval"
          ? "templateEvalStage"
          : `${name.replace(/-./g, (c) => c[1].toUpperCase())}Stage`;
      if (mod[exportName]) {
        const exported = mod[exportName];
        registry[name] = typeof exported === "function" ? exported() : exported;
      }
    } catch {
      // Stage not yet implemented — skip
    }
  }
  return registry;
}



async function ensureEvalWorkspace(): Promise<string> {
  const existing = await db
    .selectFrom("workspaces")
    .select("uuid")
    .where("slug", "=", "eval-workspace")
    .executeTakeFirst();
  if (existing) return existing.uuid;
  const created = await db
    .insertInto("workspaces")
    .values({ name: "Eval Workspace", slug: "eval-workspace" })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return created.uuid;
}

async function resolveSiteByUuid(siteUuid: string): Promise<{ siteUuid: string; workspaceUuid: string }> {
  const site = await db
    .selectFrom("sites")
    .select(["uuid", "workspaceUuid"])
    .where("uuid", "=", siteUuid)
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, workspaceUuid: site.workspaceUuid };
}

async function createNewSite(
  url: string,
  force: boolean,
): Promise<{ siteUuid: string; workspaceUuid: string }> {
  const workspaceUuid = await ensureEvalWorkspace();
  const existing = await db
    .selectFrom("sites")
    .select(["uuid", "name"])
    .where("sourceUrl", "=", url)
    .where("workspaceUuid", "=", workspaceUuid)
    .executeTakeFirst();
  if (existing) {
    if (!force) {
      console.error(
        `\n❌ A site already exists for ${url}\n` +
        `   Site: ${existing.uuid}\n` +
        `   Use --force to re-run from scratch, or use:\n` +
        `     milo upgrade --site ${existing.uuid}\n` +
        `     milo rebuild --site ${existing.uuid}\n`,
      );
      process.exit(1);
    }
    // With --force, reuse the existing site record so we overwrite its artifacts.
    return { siteUuid: existing.uuid, workspaceUuid };
  }
  const host = new URL(url).hostname.replace(/^www\./, "");
  const slug = `eval-${host.replace(/\./g, "-").slice(0, 40)}-${Date.now()}`;
  const created = await db
    .insertInto("sites")
    .values({ name: host, slug, sourceUrl: url, workspaceUuid })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { siteUuid: created.uuid, workspaceUuid };
}

async function checkPrerequisites(
  runner: StageRunner,
  ctx: StageContext,
): Promise<string | null> {
  for (const req of runner.requires) {
    const artifact = await loadArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      req as PipelineStage,
    );
    if (!artifact)
      return `"${runner.label}" requires artifact "${req}" — run prerequisite stages first`;
  }
  return null;
}

async function shouldSkip(
  runner: StageRunner,
  stageName: string,
  ctx: StageContext,
  force: boolean,
): Promise<boolean> {
  if (force || !runner.produces) return false;
  const artifact = await loadArtifact(
    ctx.db,
    { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
    runner.produces as Parameters<typeof loadArtifact>[2],
  );
  return !!artifact;
}

function renderReport(
  results: StageResult[],
  totalMs: number,
  quiet: boolean,
) {
  const pad = (s: string, w: number) => s.slice(0, w).padEnd(w);
  const icon = (s: StageResult["status"]) =>
    s === "pass"
      ? "✅ PASS"
      : s === "warn"
        ? "⚠️  WARN"
        : s === "fail"
          ? "❌ FAIL"
          : "⏭  SKIP";

  console.log(
    "\nStage          Status    Key metrics                                  Duration",
  );
  console.log("─".repeat(78));
  for (const r of results) {
    const m = Object.entries(r.metrics)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")
      .slice(0, 44);
    console.log(
      `${pad(r.stage, 14)} ${pad(icon(r.status), 9)} ${pad(m, 44)} ${Math.round(r.durationMs / 1000)}s`,
    );
  }
  console.log("─".repeat(78));
  console.log(`${"Total".padEnd(68)} ${Math.round(totalMs / 1000)}s`);

  // Always show failures regardless of quiet mode
  const failed = results.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    console.log("\nFailures:");
    failed.forEach((r) => {
      const detail = r.error ?? Object.entries(r.metrics).map(([k, v]) => `${v} ${k}`).join(", ");
      console.log(`  ❌ ${r.stage}: ${detail}`);
    });
  }

  if (!quiet) {
    const allW = results.flatMap((r) =>
      dedupeWarnings(r.warnings).map((w) => `[${r.stage}] ${w}`),
    );
    if (allW.length > 0) {
      console.log("\nWarnings:");
      allW.slice(0, 15).forEach((w) => console.log(`  ⚠  ${w}`));
      if (allW.length > 15)
        console.log(
          `  … and ${allW.length - 15} more (use --verbose for full list)`,
        );
    }

    const hasCosts = results.some((r) => r.costs);
    if (hasCosts) {
      const total = results.reduce(
        (acc, r) => ({
          s3Puts: acc.s3Puts + (r.costs?.s3Puts ?? 0),
          s3Gets: acc.s3Gets + (r.costs?.s3Gets ?? 0),
          bytes: acc.bytes + (r.costs?.s3BytesUploaded ?? 0),
          onetime: acc.onetime + (r.costs?.estimatedUsd ?? 0),
          monthly: acc.monthly + (r.costs?.monthlyStorageUsd ?? 0),
        }),
        { s3Puts: 0, s3Gets: 0, bytes: 0, onetime: 0, monthly: 0 },
      );
      const mb = (total.bytes / (1024 * 1024)).toFixed(1);
      console.log("\nEstimated resource costs (AWS us-east-1 pricing):");
      console.log(
        `  S3 ops:          ${total.s3Puts.toLocaleString()} PUTs + ${total.s3Gets.toLocaleString()} GETs`,
      );
      console.log(`  Data uploaded:   ${mb} MB`);
      console.log(`  One-time cost:   $${total.onetime.toFixed(4)}`);
      console.log(`  Monthly storage: $${total.monthly.toFixed(4)}/mo`);
    }
  }
}

async function runPipeline(
  stages: readonly string[],
  ctx: StageContext,
  registry: Record<string, StageRunner>,
  opts: { force: boolean; quiet: boolean },
): Promise<StageResult[]> {
  const results: StageResult[] = [];

  for (const stageName of stages) {
    const runner = registry[stageName];
    if (!runner) {
      results.push({
        stage: stageName, status: "fail", durationMs: 0, metrics: {}, warnings: [],
        error: `Stage "${stageName}" not found in registry`,
      });
      break;
    }

    ctx.log(`\n▶ ${stageName}`);

    const prereqErr = await checkPrerequisites(runner, ctx);
    if (prereqErr) {
      results.push({ stage: stageName, status: "fail", durationMs: 0, metrics: {}, warnings: [], error: prereqErr });
      for (const rem of [...stages].slice([...stages].indexOf(stageName) + 1)) {
        results.push({ stage: rem, status: "skipped", durationMs: 0, metrics: {}, warnings: [] });
      }
      break;
    }

    const skip = await shouldSkip(runner, stageName, ctx, opts.force);
    if (skip) {
      ctx.log(`  ⏭  skipped — artifact exists (--force to re-run)`);
      results.push({ stage: stageName, status: "skipped", durationMs: 0, metrics: {}, warnings: [] });
      continue;
    }

    const start = Date.now();
    let result: StageResult;
    try {
      result = await runner.run(ctx);
    } catch (err) {
      result = {
        stage: stageName, status: "fail", durationMs: Date.now() - start, metrics: {}, warnings: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (!result.durationMs) result.durationMs = Date.now() - start;
    results.push(result);

    if (result.status === "fail") {
      for (const rem of [...stages].slice([...stages].indexOf(stageName) + 1)) {
        results.push({ stage: rem, status: "skipped", durationMs: 0, metrics: {}, warnings: [] });
      }
      break;
    }
  }
  return results;
}

function buildCtx(
  siteUuid: string,
  workspaceUuid: string,
  opts: { verbose: boolean; quiet: boolean; tier?: "free" | "paid"; templateTheme?: "baseline" | "impact" | "beanburito"; pageFilter?: string[] },
): StageContext {
  return {
    db,
    config,
    s3Client: getS3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    }),
    siteUuid,
    workspaceUuid,
    rendererDir: resolve(dirname(fileURLToPath(import.meta.url)), "../../renderer"),
    verbose: opts.verbose,
    tier: opts.tier ?? "free",
    templateTheme: opts.templateTheme,
    pageFilter: opts.pageFilter,
    log: (msg) => { if (!opts.quiet) console.log(msg); },
  };
}

async function runNew(
  cmd: Extract<MiloCommand, { cmd: "new" }>,
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  const { siteUuid, workspaceUuid } = await createNewSite(cmd.url, cmd.force);
  const ctx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet, tier: cmd.tier, templateTheme: cmd.theme });
  if (!cmd.quiet) console.log(`\nMilo new — ${cmd.url} (site: ${siteUuid})`);
  const totalStart = Date.now();
  const results = await runPipeline(PIPELINES.new, ctx, registry, cmd);

  if (cmd.tier === "paid" && results.some((r) => r.stage === "eval" && r.status === "fail")) {
    if (!cmd.quiet) console.log("\nEval failed — running eval-fix");
    const fixResults = await runEvalFix({
      cmd: "eval-fix",
      path: "/",
      verbose: cmd.verbose,
      quiet: cmd.quiet,
    }, siteUuid, workspaceUuid);
    results.push(...fixResults);
  }

  renderReport(results, Date.now() - totalStart, cmd.quiet);
  return results;
}

async function checkJoinPrereqs(siteUuid: string, workspaceUuid: string): Promise<void> {
  const ctx = { siteUuid, workspaceUuid };
  const docgen = await loadArtifact(db, ctx, "docgen" as PipelineStage);
  if (!docgen) {
    console.error(
      `\n❌ This command requires a completed new-site pipeline.\n` +
      `   Missing artifact: docgen\n` +
      `   Run: milo new --url <url>\n`,
    );
    process.exit(1);
  }
}

async function isTier2(siteUuid: string, workspaceUuid: string): Promise<boolean> {
  const artifact = await loadArtifact(db, { siteUuid, workspaceUuid }, "generate" as PipelineStage);
  return artifact !== null;
}

async function runUpgrade(
  cmd: Extract<MiloCommand, { cmd: "upgrade" }>,
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  const { siteUuid, workspaceUuid } = await resolveSiteByUuid(cmd.site);
  await checkJoinPrereqs(siteUuid, workspaceUuid);
  const ctx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet, tier: "paid", templateTheme: cmd.theme });
  if (!cmd.quiet) console.log(`\nMilo upgrade — site: ${siteUuid}`);
  const totalStart = Date.now();
  const results = await runPipeline(PIPELINES.upgrade, ctx, registry, { ...cmd, force: true });

  if (results.some((r) => r.stage === "eval" && r.status === "fail")) {
    if (!cmd.quiet) console.log("\nEval failed — running eval-fix");
    const fixResults = await runEvalFix({
      cmd: "eval-fix",
      path: "/",
      verbose: cmd.verbose,
      quiet: cmd.quiet,
    }, siteUuid, workspaceUuid);
    results.push(...fixResults);
  }

  renderReport(results, Date.now() - totalStart, cmd.quiet);
  return results;
}

async function runRebuild(
  cmd: Extract<MiloCommand, { cmd: "rebuild" }>,
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  const { siteUuid, workspaceUuid } = await resolveSiteByUuid(cmd.site);
  const tier2 = await isTier2(siteUuid, workspaceUuid);
  if (!tier2) {
    console.error(
      `\n❌ milo rebuild requires a Tier 2 (template) site.\n` +
      `   This site is on the clone plan.\n` +
      `   Run: milo upgrade --site ${cmd.site}\n`,
    );
    process.exit(1);
  }
  const ctx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet, tier: "paid", templateTheme: cmd.theme });
  if (!cmd.quiet) console.log(`\nMilo rebuild — site: ${siteUuid}`);
  const totalStart = Date.now();
  const results = await runPipeline(PIPELINES.rebuild, ctx, registry, { force: cmd.force, quiet: cmd.quiet });

  if (results.some((r) => r.stage === "eval" && r.status === "fail")) {
    if (!cmd.quiet) console.log("\nEval failed — running eval-fix");
    const fixResults = await runEvalFix({
      cmd: "eval-fix",
      path: "/",
      verbose: cmd.verbose,
      quiet: cmd.quiet,
    }, siteUuid, workspaceUuid);
    results.push(...fixResults);
  }

  renderReport(results, Date.now() - totalStart, cmd.quiet);
  return results;
}

async function runPage(
  cmd: Extract<MiloCommand, { cmd: "page" }>,
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  const { siteUuid, workspaceUuid } = await resolveSiteByUuid(cmd.site);
  const ctx = buildCtx(siteUuid, workspaceUuid, {
    verbose: cmd.verbose,
    quiet: cmd.quiet,
    tier: "paid",
    pageFilter: [cmd.path],
  });

  if (!cmd.quiet) console.log(`\nMilo page — site: ${siteUuid}, path: ${cmd.path}`);
  const totalStart = Date.now();

  // Run content stage scoped to this page
  const contentRunner = registry["content"];
  if (!contentRunner) {
    console.error(`Stage "content" not found in registry`);
    process.exit(1);
  }

  const contentStart = Date.now();
  let contentResult: StageResult;
  try {
    contentResult = await contentRunner.run(ctx);
  } catch (err) {
    contentResult = {
      stage: "content",
      status: "fail",
      durationMs: Date.now() - contentStart,
      metrics: {},
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!contentResult.durationMs) contentResult.durationMs = Date.now() - contentStart;

  const results: StageResult[] = [contentResult];

  // Guard: verify the requested path was actually found and processed
  if (contentResult.status !== "fail") {
    const contentArtifact = await loadArtifact(
      db,
      { siteUuid, workspaceUuid },
      "content" as PipelineStage,
    ) as { payload?: { pages?: Array<{ path: string }> } } | null;
    const pathProcessed = contentArtifact?.payload?.pages?.some((p) => p.path === cmd.path) ?? false;
    if (!pathProcessed) {
      console.error(
        `\n❌ No page found at "${cmd.path}" in the site's structural pages.\n` +
        `   The path may not exist, may be a UGC page (blog/news), or may exceed the 20-page cap.\n`,
      );
      renderReport(results, Date.now() - totalStart, cmd.quiet);
      await db.destroy();
      process.exit(1);
    }
  }

  // If Tier 2 and content succeeded, trigger a rebuild
  if (contentResult.status !== "fail") {
    const tier2 = await isTier2(siteUuid, workspaceUuid);
    if (tier2) {
      if (!cmd.quiet) console.log(`\n  Tier 2 site — triggering rebuild`);
      const rebuildCtx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet, tier: "paid" });
      // Force generate+template+publish so the updated page brief flows through to the live site.
      const rebuildResults = await runPipeline(PIPELINES.rebuild, rebuildCtx, registry, { force: true, quiet: cmd.quiet });
      results.push(...rebuildResults);
    } else {
      if (!cmd.quiet) console.log(`\n  Tier 1 site — page brief saved. HTML generation for new pages is a future feature.`);
    }
  }

  renderReport(results, Date.now() - totalStart, cmd.quiet);
  return results;
}

async function runTool(
  stageName: string,
  cmd: { site: string; verbose: boolean; quiet: boolean },
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  const runner = registry[stageName];
  if (!runner) {
    console.error(`Stage "${stageName}" not found in registry`);
    process.exit(1);
  }
  const { siteUuid, workspaceUuid } = await resolveSiteByUuid(cmd.site);
  const ctx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet });
  if (!cmd.quiet) console.log(`\nMilo ${stageName} — site: ${siteUuid}`);
  const start = Date.now();
  let result: StageResult;
  try {
    result = await runner.run(ctx);
  } catch (err) {
    result = {
      stage: stageName, status: "fail", durationMs: Date.now() - start, metrics: {}, warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!result.durationMs) result.durationMs = Date.now() - start;
  renderReport([result], Date.now() - start, cmd.quiet);
  return [result];
}

async function runEval(
  cmd: Extract<MiloCommand, { cmd: "eval" }>,
): Promise<StageResult[]> {
  const { siteUuid, workspaceUuid } = await resolveSiteByUuid(cmd.site);
  const ctx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet });

  const runner = perPageEvalStage({ path: cmd.path, url: cmd.url, keywords: cmd.keywords });
  if (!cmd.quiet) console.log(`\nMilo eval — site: ${siteUuid}, path: ${cmd.path ?? "/"}`);
  const start = Date.now();
  let result: StageResult;
  try {
    result = await runner.run(ctx);
  } catch (err) {
    result = {
      stage: "eval", status: "fail", durationMs: Date.now() - start, metrics: {}, warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!result.durationMs) result.durationMs = Date.now() - start;
  renderReport([result], Date.now() - start, cmd.quiet);

  if (result.status !== "pass") {
    if (!cmd.quiet) console.log("\nEval failed — running eval-fix");
    const fixResults = await runEvalFix({
      cmd: "eval-fix",
      path: cmd.path,
      url: cmd.url,
      keywords: cmd.keywords,
      verbose: cmd.verbose,
      quiet: cmd.quiet,
    }, siteUuid, workspaceUuid);
    return [result, ...fixResults];
  }
  return [result];
}

async function runEvalFix(
  cmd: Extract<MiloCommand, { cmd: "eval-fix" }>,
  explicitSiteUuid?: string,
  explicitWorkspaceUuid?: string,
): Promise<StageResult[]> {
  if (!explicitSiteUuid && !cmd.site) {
    throw new Error("runEvalFix requires either explicitSiteUuid or cmd.site");
  }
  const { siteUuid, workspaceUuid } =
    explicitSiteUuid && explicitWorkspaceUuid
      ? { siteUuid: explicitSiteUuid, workspaceUuid: explicitWorkspaceUuid }
      : await resolveSite(undefined, cmd.site);
  const ctx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet, tier: "paid" });
  const runner = evalFixStage({
    evalUuid: cmd.evalUuid,
    path: cmd.path,
    url: cmd.url,
    keywords: cmd.keywords,
    scoreThreshold: cmd.scoreThreshold,
    maxLoops: cmd.maxLoops,
  });
  if (!cmd.quiet) {
    const source = cmd.evalUuid ? `eval ${cmd.evalUuid}` : `path ${cmd.path ?? "/"}`;
    console.log(`\nMilo eval-fix — site: ${siteUuid}, ${source}`);
  }
  const start = Date.now();
  let result: StageResult;
  try {
    result = await runner.run(ctx);
  } catch (err) {
    result = {
      stage: "eval-fix", status: "fail", durationMs: Date.now() - start, metrics: {}, warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!result.durationMs) result.durationMs = Date.now() - start;
  renderReport([result], Date.now() - start, cmd.quiet);
  return [result];
}

async function runRestore(
  cmd: Extract<MiloCommand, { cmd: "restore" }>,
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  // The restore stage reads --version directly from process.argv.
  return runTool("restore", cmd, registry);
}

async function runLegacyStages(
  cmd: Extract<MiloCommand, { cmd: "stages" }>,
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  for (const s of cmd.stages) {
    if (!registry[s]) {
      console.error(`Unknown stage: "${s}". Available: ${Object.keys(registry).join(", ")}`);
      process.exit(1);
    }
  }
  const { siteUuid, workspaceUuid } = await resolveSiteByUuid(cmd.site);
  const ctx = buildCtx(siteUuid, workspaceUuid, { verbose: cmd.verbose, quiet: cmd.quiet, tier: cmd.tier, templateTheme: cmd.templateTheme });
  if (!cmd.quiet) console.log(`\nMilo pipeline — site: ${siteUuid}`);
  const totalStart = Date.now();
  const results = await runPipeline(cmd.stages, ctx, registry, cmd);
  renderReport(results, Date.now() - totalStart, cmd.quiet);
  return results;
}

async function runPublish(
  cmd: Extract<MiloCommand, { cmd: "publish" }>,
  registry: Record<string, StageRunner>,
): Promise<StageResult[]> {
  return runTool("publish", cmd, registry);
}

async function main() {
  const cmd = parseArgs();
  const registry = await loadRegistry();

  let results: StageResult[] = [];
  switch (cmd.cmd) {
    case "new":     results = await runNew(cmd, registry); break;
    case "stages":  results = await runLegacyStages(cmd, registry); break;
    case "upgrade": results = await runUpgrade(cmd, registry); break;
    case "rebuild": results = await runRebuild(cmd, registry); break;
    case "publish": results = await runPublish(cmd, registry); break;
    case "page":    results = await runPage(cmd, registry); break;
    case "eval":    results = await runEval(cmd); break;
    case "eval-fix": results = await runEvalFix(cmd); break;
    case "nav":     results = await runTool("nav-rebuild", cmd, registry); break;
    case "restore": results = await runRestore(cmd, registry); break;
    default: {
      const c = cmd as MiloCommand;
      console.error(`Handler for "${(c as { cmd: string }).cmd}" not implemented.`);
      process.exit(1);
    }
  }

  await db.destroy();
  // Eval and eval-fix are post-publish QA/corrective stages. Their failures
  // should not block the upgrade/rebuild command from completing, since the
  // publish has already happened and the live site carries the clean build.
  const qaStages = new Set(["eval", "eval-fix"]);
  const gatingFailures = results.filter((r) => r.status === "fail" && !qaStages.has(r.stage));
  process.exit(gatingFailures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
