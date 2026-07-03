/**
 * Pipeline eval harness — thin CLI over the 5 stage functions.
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/eval/run-pipeline.ts \
 *     --urls ../../eval-gym-urls.txt \
 *     [--pages /] \
 *     [--limit 5] \
 *     [--stages extract,segment,docgen,build,verify] \
 *     [--report scripts/eval/eval-report-YYYY-MM-DD.md] \
 *     [--mock-llm | --live]
 *
 * For each URL:
 *   1. Create (or reuse) an eval site record — slug = `eval-<sha1(url).slice(0,10)>`
 *   2. Run the requested stages sequentially by calling the runXxxStage
 *      functions directly. No BullMQ; synchronous.
 *   3. On verify: collect the VerifyArtifact.
 *   4. Self-heal — for each `actionable` entry, re-run `suggestedStage` ONCE
 *      then re-verify. Track pre-heal and post-heal fidelity separately.
 *
 * Writes a Markdown report with the same section structure as the historical
 * eval-report.md / eval-report-2.md snapshots.
 *
 * Default LLM behavior: `--mock-llm` (spins up an in-process HTTP mock server
 * and points OPENROUTER_BASE_URL at it). Pass `--live` to hit the real
 * provider configured by the environment.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createServer, type Server } from "http";
import { chromium } from "playwright";

// tsx's esbuild transformer runs with `keepNames: true`, which injects a
// `__name(...)` wrapper around arrow functions in the source. That wrapper
// is defined at module scope, so it's absent inside `page.evaluate(...)`
// where the arrow function's `.toString()` is re-evaluated in the browser.
// The result is a `ReferenceError: __name is not defined`.
//
// Patch every browser context we hand out to define `__name` as an identity
// function before any page script runs. This keeps the eval usable via
// `pnpm tsx` without changing the pipeline stage code, which handles this
// in its own compiled build.
const originalNewContext = chromium.launch;
chromium.launch = async function patchedLaunch(...args: Parameters<typeof chromium.launch>) {
  const browser = await originalNewContext.apply(this, args);
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...ctxArgs) => {
    const ctx = await origNewContext(...ctxArgs);
    await ctx.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__name ??= (fn: unknown) => fn;
    });
    return ctx;
  };
  return browser;
} as typeof chromium.launch;

import { db, config as baseConfig } from "../../src/database";
import { getS3Client, ensureBuckets } from "../../src/s3";
import type { Config } from "../../src/plugins/env";
import {
  runExtractStage,
  type ExtractStageInput,
} from "../../src/services/pipeline/extract-stage";
import {
  runSegmentStage,
  type SegmentStageInput,
} from "../../src/services/pipeline/segment-stage";
import {
  runDocgenStage,
  type DocgenStageInput,
} from "../../src/services/pipeline/docgen-stage";
import {
  runBuildStage,
  type BuildStageInput,
} from "../../src/services/pipeline/build-stage";
import {
  runVerifyStage,
  type VerifyStageInput,
} from "../../src/services/pipeline/verify-stage";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { saveSiteDocs } from "../../src/utils/site-docs";
import type {
  ExtractArtifact,
  SegmentArtifact,
  VerifyArtifact,
  PipelineStage,
} from "../../src/types/pipeline-artifacts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CLI ----------

type Args = {
  urls: string;
  pages: string[] | null;
  limit: number | null;
  stages: PipelineStage[];
  report: string;
  mockLlm: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      flags.add(key);
    }
  }
  const stages = (args["stages"] ?? "extract,segment,docgen,build,verify")
    .split(",")
    .map((s) => s.trim() as PipelineStage);
  const today = new Date().toISOString().slice(0, 10);
  const report =
    args["report"] ??
    path.join(__dirname, `eval-report-${today}.md`);

  // Default: mock. Only skip mock if --live is set.
  const mockLlm = !flags.has("live");

  return {
    urls: args["urls"] ?? path.join(__dirname, "sites.txt"),
    pages: args["pages"] ? args["pages"].split(",").map((p) => p.trim()) : null,
    limit: args["limit"] ? Number(args["limit"]) : null,
    stages,
    report,
    mockLlm,
  };
}

function readUrls(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => l && !l.startsWith("#"));
}

function urlHash(url: string): string {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
}

// ---------- Mock LLM ----------

/**
 * A pathological LLM stub server that speaks the OpenRouter/OpenAI chat-
 * completion protocol. Returns responses that are safe for every current
 * pipeline caller:
 *   - JSON-array classifier: returns []
 *   - JSON-object vision compare: returns {"score": 0, "differences": []}
 *   - anything else: returns a short generic string.
 * This lets us exercise the pipeline end-to-end without paying for tokens.
 */
async function startMockLlm(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let requestedJson = false;
      let prompt = "";
      try {
        const parsed = JSON.parse(body);
        requestedJson = parsed?.response_format?.type === "json_object";
        const msgs = parsed?.messages ?? [];
        const last = msgs[msgs.length - 1];
        prompt =
          typeof last?.content === "string"
            ? last.content
            : JSON.stringify(last?.content ?? "");
      } catch {
        /* ignore */
      }

      let content = "OK.";
      if (/JSON array/i.test(prompt) || /\{"index":/i.test(prompt)) {
        content = "[]";
      } else if (requestedJson || /"score"/i.test(prompt)) {
        content = JSON.stringify({ score: 0, differences: [] });
      }

      const payload = {
        id: "mock-completion",
        object: "chat.completion",
        model: "mock",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// ---------- Site setup ----------

async function ensureEvalSite(
  workspaceUuid: string,
  url: string,
): Promise<{ siteUuid: string; slug: string }> {
  const slug = `eval-${urlHash(url)}`;
  const existing = await db
    .selectFrom("sites")
    .select(["uuid", "slug"])
    .where("workspaceUuid", "=", workspaceUuid)
    .where("slug", "=", slug)
    .executeTakeFirst();
  if (existing) return { siteUuid: existing.uuid, slug };

  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid,
      name: `Eval ${new URL(url).hostname}`,
      slug,
      sourceUrl: url,
      status: "draft",
      mode: "replication",
    })
    .returning(["uuid", "slug"])
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, slug: site.slug };
}

async function ensureEvalWorkspace(): Promise<string> {
  const existing = await db
    .selectFrom("workspaces")
    .select("uuid")
    .where("slug", "=", "local")
    .executeTakeFirst();
  if (existing) return existing.uuid;

  const other = await db
    .selectFrom("workspaces")
    .select("uuid")
    .limit(1)
    .executeTakeFirst();
  if (!other) {
    throw new Error(
      "No workspaces found. Run `pnpm seed` first, or create a workspace before running the eval.",
    );
  }
  return other.uuid;
}

// ---------- Stage runner ----------

interface StageOutcome {
  extract?: ExtractArtifact;
  segment?: SegmentArtifact;
  verify?: VerifyArtifact;
  failedStage?: PipelineStage;
  error?: string;
}

async function runStages(opts: {
  siteUuid: string;
  workspaceUuid: string;
  url: string;
  pages: string[] | null;
  stages: PipelineStage[];
  config: Config;
  s3: ReturnType<typeof getS3Client>;
}): Promise<StageOutcome> {
  const { siteUuid, workspaceUuid, url, pages, stages, config, s3 } = opts;
  const outcome: StageOutcome = {};

  try {
    if (stages.includes("extract")) {
      const input: ExtractStageInput = {
        db,
        config,
        s3,
        siteUuid,
        workspaceUuid,
        url,
        pages: pages ?? undefined,
      };
      outcome.extract = await runExtractStage(input);
    }

    if (stages.includes("segment")) {
      const input: SegmentStageInput = {
        db,
        config,
        s3,
        siteUuid,
        workspaceUuid,
        pages: pages ?? undefined,
      };
      outcome.segment = await runSegmentStage(input);
    }

    if (stages.includes("docgen")) {
      const input: DocgenStageInput = {
        db,
        config,
        s3,
        siteUuid,
        workspaceUuid,
        mode: "replication",
      };
      const docs = await runDocgenStage(input);
      await saveSiteDocs(db, workspaceUuid, docs, siteUuid);
    }

    if (stages.includes("build")) {
      const input: BuildStageInput = {
        db,
        config,
        s3,
        siteUuid,
        workspaceUuid,
        pages: pages ?? undefined,
        runAstroBuild: true,
        runAstroCheck: true,
      };
      await runBuildStage(input);
    }

    if (stages.includes("verify")) {
      const input: VerifyStageInput = {
        db,
        config,
        s3,
        siteUuid,
        workspaceUuid,
        pages: pages ?? undefined,
      };
      outcome.verify = await runVerifyStage(input);
    }
  } catch (err) {
    const stage = detectFailedStage(err, stages);
    outcome.failedStage = stage;
    outcome.error = err instanceof Error ? err.message : String(err);
  }

  return outcome;
}

function detectFailedStage(
  err: unknown,
  stages: PipelineStage[],
): PipelineStage {
  const msg = err instanceof Error ? err.message : String(err);
  // Cheap heuristic: match phrases the stage functions throw.
  if (/extract artifact/i.test(msg)) return "extract";
  if (/segment artifact/i.test(msg)) return "segment";
  if (/hierarchy|design system/i.test(msg)) return "docgen";
  if (/build/i.test(msg)) return "build";
  if (/verify/i.test(msg)) return "verify";
  // fallback: first requested stage
  return stages[0] ?? "extract";
}

// ---------- Self-heal ----------

async function selfHeal(opts: {
  siteUuid: string;
  workspaceUuid: string;
  url: string;
  pages: string[] | null;
  verify: VerifyArtifact;
  config: Config;
  s3: ReturnType<typeof getS3Client>;
}): Promise<VerifyArtifact | null> {
  const { verify } = opts;
  if (verify.actionable.length === 0) return null;

  const uniqueStages = Array.from(
    new Set(verify.actionable.map((a) => a.suggestedStage)),
  ) as PipelineStage[];
  // Include a final verify after re-runs.
  const rerunStages: PipelineStage[] = [...uniqueStages, "verify"];

  const outcome = await runStages({ ...opts, stages: rerunStages });
  return outcome.verify ?? null;
}

// ---------- Aggregation ----------

interface PerUrlRow {
  url: string;
  slug: string;
  stagesRun: PipelineStage[];
  extract?: ExtractArtifact;
  segment?: SegmentArtifact;
  verify?: VerifyArtifact;
  verifyPostHeal?: VerifyArtifact;
  failedStage?: PipelineStage;
  error?: string;
  durationMs: number;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function histogram(nums: number[], bins: number[]): Array<{ range: string; count: number }> {
  const rows = bins.map((_, i) => {
    const lo = bins[i];
    const hi = bins[i + 1] ?? Infinity;
    const label = hi === Infinity ? `${lo}+` : `${lo}–${hi - 1}`;
    return {
      range: label,
      count: nums.filter((n) => n >= lo && n < hi).length,
    };
  });
  return rows;
}

function renderReport(rows: PerUrlRow[], args: Args): string {
  const successful = rows.filter((r) => !r.failedStage);
  const failed = rows.filter((r) => r.failedStage);

  const masterScoresPre = successful
    .map((r) => r.verify?.scores.masterFidelity)
    .filter((n): n is number => typeof n === "number");
  const masterScoresPost = successful
    .map(
      (r) =>
        r.verifyPostHeal?.scores.masterFidelity ??
        r.verify?.scores.masterFidelity,
    )
    .filter((n): n is number => typeof n === "number");

  const rung1Counts = successful.flatMap(
    (r) => r.segment?.pages.map((p) => p.ladder.rung1Count) ?? [],
  );
  const sectionCounts = successful.map(
    (r) =>
      r.segment?.pages.reduce((sum, p) => sum + p.sections.length, 0) ?? 0,
  );

  const visionPages = successful.flatMap(
    (r) => r.segment?.pages ?? [],
  );
  const visionUsedCount = visionPages.filter((p) => p.ladder.visionUsed).length;
  const visionRate =
    visionPages.length === 0
      ? 0
      : (visionUsedCount / visionPages.length) * 100;

  const perStageFailures = new Map<PipelineStage, number>();
  for (const r of failed) {
    const s = r.failedStage!;
    perStageFailures.set(s, (perStageFailures.get(s) ?? 0) + 1);
  }

  const scoreBins = [0, 20, 40, 60, 70, 80, 90, 100];
  const preHist = histogram(masterScoresPre, scoreBins);
  const postHist = histogram(masterScoresPost, scoreBins);

  const healedCount = successful.filter(
    (r) =>
      r.verifyPostHeal &&
      r.verify &&
      r.verifyPostHeal.scores.masterFidelity >
        r.verify.scores.masterFidelity,
  ).length;
  const healedAttempted = successful.filter((r) => r.verifyPostHeal).length;

  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`# Pipeline Eval Report`);
  lines.push("");
  lines.push(`**Date:** ${today}  `);
  lines.push(`**URLs file:** \`${args.urls}\` (${rows.length} sites processed)  `);
  lines.push(
    `**Stages:** ${args.stages.join(" → ")}  `,
  );
  lines.push(
    `**Pages:** ${args.pages ? args.pages.join(", ") : "all captured"}  `,
  );
  lines.push(`**LLM:** ${args.mockLlm ? "mocked (in-process HTTP stub)" : "live"}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## 1. Summary");
  lines.push("");
  lines.push(`- Successful runs: ${successful.length}/${rows.length}`);
  lines.push(`- Failed runs: ${failed.length}/${rows.length}`);
  if (masterScoresPre.length) {
    lines.push(
      `- Master fidelity (pre-heal): min ${Math.min(...masterScoresPre)}, median ${median(masterScoresPre).toFixed(1)}, max ${Math.max(...masterScoresPre)}`,
    );
  }
  if (masterScoresPost.length) {
    lines.push(
      `- Master fidelity (post-heal): min ${Math.min(...masterScoresPost)}, median ${median(masterScoresPost).toFixed(1)}, max ${Math.max(...masterScoresPost)}`,
    );
  }
  lines.push(
    `- Self-heal effectiveness: ${healedCount}/${healedAttempted} runs improved after re-running suggested stages`,
  );
  lines.push(
    `- Vision-usage rate: ${visionRate.toFixed(1)}% of segmented pages (${visionUsedCount}/${visionPages.length})`,
  );
  if (rung1Counts.length) {
    lines.push(
      `- Rung-1 (semantic) section counts: min ${Math.min(...rung1Counts)}, median ${median(rung1Counts).toFixed(1)}, max ${Math.max(...rung1Counts)}`,
    );
  }
  if (sectionCounts.length) {
    lines.push(
      `- Total sections / URL: min ${Math.min(...sectionCounts)}, median ${median(sectionCounts).toFixed(1)}, max ${Math.max(...sectionCounts)}`,
    );
  }
  lines.push("");

  lines.push("## 2. Per-URL results");
  lines.push("");
  lines.push(
    "| # | URL | Duration | Sections | Rung1 | Vision | Fidelity (pre) | Fidelity (post) | Failed stage |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const [i, r] of rows.entries()) {
    const sections = r.segment
      ? r.segment.pages.reduce((s, p) => s + p.sections.length, 0)
      : "—";
    const rung1 =
      r.segment && r.segment.pages.length > 0
        ? r.segment.pages
            .map((p) => p.ladder.rung1Count)
            .reduce((a, b) => a + b, 0)
        : "—";
    const vision =
      r.segment && r.segment.pages.some((p) => p.ladder.visionUsed)
        ? "yes"
        : r.segment
          ? "no"
          : "—";
    const pre = r.verify?.scores.masterFidelity ?? "—";
    const post =
      r.verifyPostHeal?.scores.masterFidelity ??
      (r.verify ? r.verify.scores.masterFidelity : "—");
    const failed = r.failedStage ?? "";
    lines.push(
      `| ${i + 1} | ${r.url} | ${(r.durationMs / 1000).toFixed(1)}s | ${sections} | ${rung1} | ${vision} | ${pre} | ${post} | ${failed} |`,
    );
  }
  lines.push("");

  lines.push("## 3. Per-stage failures");
  lines.push("");
  lines.push("| Stage | Failures |");
  lines.push("|---|---|");
  for (const stage of ["extract", "segment", "docgen", "build", "verify"] as PipelineStage[]) {
    lines.push(`| ${stage} | ${perStageFailures.get(stage) ?? 0} |`);
  }
  lines.push("");

  lines.push("## 4. Fidelity distribution");
  lines.push("");
  lines.push("### Pre-heal");
  lines.push("");
  lines.push("| Range | Count |");
  lines.push("|---|---|");
  for (const b of preHist) lines.push(`| ${b.range} | ${b.count} |`);
  lines.push("");
  lines.push("### Post-heal");
  lines.push("");
  lines.push("| Range | Count |");
  lines.push("|---|---|");
  for (const b of postHist) lines.push(`| ${b.range} | ${b.count} |`);
  lines.push("");

  if (failed.length > 0) {
    lines.push("## 5. Failure details");
    lines.push("");
    lines.push("| URL | Failed stage | Error |");
    lines.push("|---|---|---|");
    for (const r of failed) {
      const err = (r.error ?? "").replace(/\|/g, "\\|").slice(0, 240);
      lines.push(`| ${r.url} | ${r.failedStage ?? ""} | ${err} |`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

// ---------- Main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.urls)) {
    console.error(`URLs file not found: ${args.urls}`);
    process.exit(1);
  }
  const allUrls = readUrls(args.urls);
  const urls = args.limit ? allUrls.slice(0, args.limit) : allUrls;
  if (urls.length === 0) {
    console.error("No URLs found in", args.urls);
    process.exit(1);
  }

  // Optionally spin up the mock LLM before the config is captured.
  let mockLlm: Awaited<ReturnType<typeof startMockLlm>> | null = null;
  if (args.mockLlm) {
    mockLlm = await startMockLlm();
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_BASE_URL = mockLlm.url;
    process.env.OPENROUTER_API_KEY = "mock";
    console.log(`Mock LLM listening at ${mockLlm.url}`);
  }

  // Snapshot the mutated env into the Config for the stage functions.
  const config: Config = {
    ...baseConfig,
    LLM_PROVIDER: (process.env.LLM_PROVIDER as Config["LLM_PROVIDER"]) ?? baseConfig.LLM_PROVIDER,
    OPENROUTER_BASE_URL:
      process.env.OPENROUTER_BASE_URL ?? baseConfig.OPENROUTER_BASE_URL,
    OPENROUTER_API_KEY:
      process.env.OPENROUTER_API_KEY ?? baseConfig.OPENROUTER_API_KEY,
  };

  const s3 = getS3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    sessionToken: config.S3_SESSION_TOKEN,
  });
  try {
    await ensureBuckets(s3, [config.S3_ASSETS_BUCKET]);
  } catch (err) {
    console.warn(
      `[warn] ensureBuckets failed (S3 may not be reachable): ${String(err)}`,
    );
  }

  const workspaceUuid = await ensureEvalWorkspace();
  console.log(`Using workspace ${workspaceUuid}`);
  console.log(`Processing ${urls.length} URLs...\n`);

  const rows: PerUrlRow[] = [];
  for (const [i, url] of urls.entries()) {
    console.log(`\n[${i + 1}/${urls.length}] ${url}`);
    const start = Date.now();
    const { siteUuid, slug } = await ensureEvalSite(workspaceUuid, url);
    const row: PerUrlRow = {
      url,
      slug,
      stagesRun: args.stages,
      durationMs: 0,
    };
    try {
      const outcome = await runStages({
        siteUuid,
        workspaceUuid,
        url,
        pages: args.pages,
        stages: args.stages,
        config,
        s3,
      });
      row.extract = outcome.extract;
      row.segment = outcome.segment;
      row.verify = outcome.verify;
      row.failedStage = outcome.failedStage;
      row.error = outcome.error;

      // Fallback: even if verify wasn't run this pass, try to load the last
      // stored artifact so re-runs still capture context.
      if (!row.segment) {
        const stored = await loadArtifact<SegmentArtifact>(
          db,
          { siteUuid, workspaceUuid },
          "segment",
        );
        if (stored) row.segment = stored.payload;
      }

      if (row.verify && row.verify.actionable.length > 0) {
        console.log(
          `  ↺ self-heal: ${row.verify.actionable.length} actionable items`,
        );
        const healed = await selfHeal({
          siteUuid,
          workspaceUuid,
          url,
          pages: args.pages,
          verify: row.verify,
          config,
          s3,
        });
        if (healed) row.verifyPostHeal = healed;
      }

      const sections = row.segment
        ? row.segment.pages.reduce((s, p) => s + p.sections.length, 0)
        : 0;
      console.log(
        `  done — sections=${sections}, fidelity=${row.verify?.scores.masterFidelity ?? "n/a"}${row.failedStage ? `, failed=${row.failedStage}` : ""}`,
      );
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
      row.failedStage = "extract";
      console.error(`  ✗ ${row.error}`);
    }
    row.durationMs = Date.now() - start;
    rows.push(row);
  }

  await mkdir(path.dirname(args.report), { recursive: true });
  const md = renderReport(rows, args);
  await writeFile(args.report, md);
  console.log(`\nReport written to ${args.report}`);

  await mockLlm?.close();
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
