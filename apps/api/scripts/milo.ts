// apps/api/scripts/milo.ts
// Must be first — loads apps/api/.env (DB_PORT=5434 etc.) before database module initializes
import "dotenv/config";
import { configDotenv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

configDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  override: false,
});

import { db, config } from "../src/database";
import { getS3Client } from "../src/s3";
import { loadArtifact } from "../src/utils/pipeline/artifact-store";
import type { StageRunner, StageResult, StageContext } from "./stages/types";
import { dedupeWarnings } from "./stages/types";

async function loadRegistry(): Promise<Record<string, StageRunner>> {
  // Lazy: only attempt to load stages that exist
  const registry: Record<string, StageRunner> = {};
  const stageModules: [string, string][] = [
    ["mirror", "./stages/mirror.js"],
    ["eval", "./stages/eval.js"],
    ["extract", "./stages/extract.js"],
    ["segment", "./stages/segment.js"],
    ["docgen", "./stages/docgen.js"],
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
      if (mod[exportName]) registry[name] = mod[exportName] as StageRunner;
    } catch {
      // Stage not yet implemented — skip
    }
  }
  return registry;
}

const DEFAULT_STAGES_FOR_URL = ["mirror", "extract", "segment", "docgen", "eval"];

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
      ? argv[i + 1]
      : undefined;
  };
  const has = (flag: string) => argv.includes(`--${flag}`);
  const url = get("url");
  const site = get("site");
  const stagesStr = get("stages");
  const stages = stagesStr
    ? stagesStr.split(",").map((s) => s.trim())
    : url
      ? DEFAULT_STAGES_FOR_URL
      : null;
  if (!url && !site) {
    console.error(
      "Usage: pnpm milo --url <url> [--stages s1,s2] [--verbose] [--quiet] [--force]",
    );
    console.error(
      "       pnpm milo --site <uuid> --stages s1,s2",
    );
    process.exit(1);
  }
  if (site && !stages) {
    console.error(
      "--site requires --stages (no default when targeting an existing site)",
    );
    process.exit(1);
  }
  return {
    url,
    site,
    stages: stages!,
    verbose: has("verbose"),
    quiet: has("quiet"),
    force: has("force"),
  };
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

async function resolveSite(
  url: string | undefined,
  siteUuid: string | undefined,
): Promise<{ siteUuid: string; workspaceUuid: string }> {
  if (siteUuid) {
    const site = await db
      .selectFrom("sites")
      .select(["uuid", "workspaceUuid"])
      .where("uuid", "=", siteUuid)
      .executeTakeFirstOrThrow();
    return { siteUuid: site.uuid, workspaceUuid: site.workspaceUuid };
  }
  const workspaceUuid = await ensureEvalWorkspace();
  const existing = await db
    .selectFrom("sites")
    .select("uuid")
    .where("sourceUrl", "=", url!)
    .where("workspaceUuid", "=", workspaceUuid)
    .executeTakeFirst();
  if (existing) return { siteUuid: existing.uuid, workspaceUuid };
  const host = new URL(url!).hostname.replace(/^www\./, "");
  const slug = `eval-${host.replace(/\./g, "-").slice(0, 40)}-${Date.now()}`;
  const created = await db
    .insertInto("sites")
    .values({ name: host, slug, sourceUrl: url!, workspaceUuid })
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
      req as any,
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

async function main() {
  const args = parseArgs();
  const registry = await loadRegistry();

  for (const s of args.stages) {
    if (!registry[s]) {
      console.error(
        `Unknown stage: "${s}". Available: ${Object.keys(registry).join(", ")}`,
      );
      process.exit(1);
    }
  }

  const { siteUuid, workspaceUuid } = await resolveSite(args.url, args.site);
  const s3Client = getS3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  });
  const ctx: StageContext = {
    db,
    config,
    s3Client,
    siteUuid,
    workspaceUuid,
    rendererDir: resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../renderer",
    ),
    verbose: args.verbose,
    log: (msg) => {
      if (!args.quiet) console.log(msg);
    },
  };

  if (!args.quiet) console.log(`\nMilo pipeline — site: ${siteUuid}`);

  const results: StageResult[] = [];
  const totalStart = Date.now();

  for (const stageName of args.stages) {
    const runner = registry[stageName];
    ctx.log(`\n▶ ${stageName}`);

    const prereqErr = await checkPrerequisites(runner, ctx);
    if (prereqErr) {
      results.push({
        stage: stageName,
        status: "fail",
        durationMs: 0,
        metrics: {},
        warnings: [],
        error: prereqErr,
      });
      for (const rem of args.stages.slice(
        args.stages.indexOf(stageName) + 1,
      )) {
        results.push({
          stage: rem,
          status: "skipped",
          durationMs: 0,
          metrics: {},
          warnings: [],
        });
      }
      break;
    }

    const skip = await shouldSkip(runner, stageName, ctx, args.force);
    if (skip) {
      ctx.log(`  ⏭  skipped — artifact exists (--force to re-run)`);
      results.push({
        stage: stageName,
        status: "skipped",
        durationMs: 0,
        metrics: {},
        warnings: [],
      });
      continue;
    }

    const start = Date.now();
    let result: StageResult;
    try {
      result = await runner.run(ctx);
    } catch (err) {
      result = {
        stage: stageName,
        status: "fail",
        durationMs: Date.now() - start,
        metrics: {},
        warnings: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (!result.durationMs) result.durationMs = Date.now() - start;
    results.push(result);

    if (result.status === "fail") {
      for (const rem of args.stages.slice(
        args.stages.indexOf(stageName) + 1,
      )) {
        results.push({
          stage: rem,
          status: "skipped",
          durationMs: 0,
          metrics: {},
          warnings: [],
        });
      }
      break;
    }
  }

  renderReport(results, Date.now() - totalStart, args.quiet);
  await db.destroy();
  process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
