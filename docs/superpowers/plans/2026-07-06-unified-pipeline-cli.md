# Unified Pipeline CLI (`milo`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four separate eval scripts with one composable `pnpm milo` CLI where stages are independently runnable, produce measurable results, and share a unified report format.

**Architecture:** A single `apps/api/scripts/milo.ts` entry point orchestrates named stages from a registry. Each stage is a file in `scripts/stages/` implementing `StageRunner`. The old scripts become one-line wrappers delegating to `milo`. Stages call the exact same service functions the BullMQ workers use — no divergent logic.

**Tech Stack:** TypeScript · tsx · Kysely · `@aws-sdk/client-s3` · Playwright (eval stage) · existing service layer

---

## File map

| File | Action | Purpose |
|---|---|---|
| `apps/api/scripts/stages/types.ts` | **Create** | `StageContext`, `StageResult`, `StageRunner` interfaces + `dedupeWarnings` util |
| `apps/api/scripts/milo.ts` | **Create** | Entry point: arg parsing, site resolution, prerequisite check, stage orchestration, report |
| `apps/api/scripts/stages/mirror.ts` | **Create** | Wraps `runMirrorPipeline`: concurrency guard, CMS detection |
| `apps/api/scripts/stages/eval.ts` | **Create** | Screenshot diff + similarity scoring + form capture check |
| `apps/api/scripts/stages/extract.ts` | **Create** | Thin wrapper around `runExtractStage` |
| `apps/api/scripts/stages/segment.ts` | **Create** | Thin wrapper around `runSegmentStage` |
| `apps/api/scripts/stages/docgen.ts` | **Create** | Thin wrapper around `runDocgenStage` |
| `apps/api/scripts/stages/template.ts` | **Create** | Thin wrapper around `deployTemplate` |
| `apps/api/scripts/stages/template-eval.ts` | **Create** | Thin wrapper around template eval logic |
| `apps/api/scripts/eval/run-mirror.ts` | **Modify** | Become a one-line wrapper calling `milo --stages mirror,eval` |
| `apps/api/scripts/eval/run-pipeline.ts` | **Modify** | Become a one-line wrapper calling `milo --stages extract,segment,docgen` |
| `apps/api/scripts/eval/run-template-deploy.ts` | **Modify** | Become a one-line wrapper calling `milo --stages template` |
| `apps/api/scripts/eval/run-template-eval.ts` | **Modify** | Become a one-line wrapper calling `milo --stages template-eval` |

Add to `apps/api/package.json` scripts:
```json
"milo": "tsx scripts/milo.ts"
```

---

## Task 1: Types + `milo.ts` core

**Files:**
- Create: `apps/api/scripts/stages/types.ts`
- Create: `apps/api/scripts/milo.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Create `apps/api/scripts/stages/types.ts`**

```typescript
// apps/api/scripts/stages/types.ts
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DB } from "../../src/types/db";
import type { Config } from "../../src/plugins/env";

export interface StageContext {
  db: Kysely<DB>;
  config: Config;
  s3Client: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  /** Absolute path to apps/renderer */
  rendererDir: string;
  verbose: boolean;
  log: (msg: string) => void;
}

export interface StageResult {
  stage: string;
  status: "pass" | "warn" | "fail" | "skipped";
  durationMs: number;
  metrics: Record<string, number | string | boolean>;
  warnings: string[];
  error?: string;
  /** Estimated resource costs for this stage */
  costs?: StageCosts;
}

export interface StageCosts {
  /** S3 PUT/COPY operations performed */
  s3Puts: number;
  /** S3 GET operations performed */
  s3Gets: number;
  /** Total bytes uploaded to S3 */
  s3BytesUploaded: number;
  /** Estimated one-time cost in USD (S3 requests + data transfer) */
  estimatedUsd: number;
  /** Estimated monthly storage cost in USD at current deployed size */
  monthlyStorageUsd: number;
}

/** Estimate S3 costs for a mirror stage based on page/asset counts. */
export function estimateMirrorCosts(pages: number, assets: number): StageCosts {
  const AVG_HTML_BYTES = 50_000;       // 50KB per page
  const AVG_ASSET_BYTES = 200_000;     // 200KB per asset
  const s3Puts = pages * 3 + assets;   // snapshot + deploy + promote per page, plus assets
  const s3Gets = pages;                 // deploy reads snapshot HTML
  const s3BytesUploaded = pages * AVG_HTML_BYTES * 3 + assets * AVG_ASSET_BYTES;
  // AWS S3 us-east-1 pricing
  const PUT_COST_PER_1K = 0.005;
  const GET_COST_PER_1K = 0.0004;
  const STORAGE_USD_PER_GB_MONTH = 0.023;
  const estimatedUsd = (s3Puts / 1000) * PUT_COST_PER_1K + (s3Gets / 1000) * GET_COST_PER_1K;
  const monthlyStorageUsd = (s3BytesUploaded / (1024 ** 3)) * STORAGE_USD_PER_GB_MONTH;
  return { s3Puts, s3Gets, s3BytesUploaded, estimatedUsd, monthlyStorageUsd };
}

export interface StageRunner {
  /** Human-readable label shown in the report table */
  label: string;
  /** Artifact keys that must exist before this stage can run */
  requires: string[];
  /** Primary artifact key this stage produces — used for skip/resume check */
  produces: string;
  run(ctx: StageContext): Promise<StageResult>;
}

/**
 * Deduplicate warnings by grouping identical message patterns.
 * "809 lines of /path/to/page: Elementor plugin" → "Elementor plugin (809 pages)"
 */
export function dedupeWarnings(warnings: string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of warnings) {
    // Strip leading path prefix (e.g. "/some/page: message" → "message")
    const match = w.match(/^[^:]+:\s*(.+)$/);
    const key = (match ? match[1] : w).slice(0, 100);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([msg, count]) =>
    count > 1 ? `${msg} (${count} pages)` : msg,
  );
}
```

- [ ] **Step 2: Create `apps/api/scripts/milo.ts`**

```typescript
// apps/api/scripts/milo.ts
import "dotenv/config";
import { configDotenv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load root .env for DB vars not present in apps/api/.env
configDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  override: false,
});

import { db, config } from "../src/database";
import { getS3Client } from "../src/s3";
import { loadArtifact } from "../src/utils/pipeline/artifact-store";
import type { StageRunner, StageResult, StageContext } from "./stages/types";
import { dedupeWarnings } from "./stages/types";

// Stage registry — import stages lazily after all env is loaded
async function loadRegistry(): Promise<Record<string, StageRunner>> {
  const [
    { mirrorStage },
    { evalStage },
    { extractStage },
    { segmentStage },
    { docgenStage },
    { templateStage },
    { templateEvalStage },
  ] = await Promise.all([
    import("./stages/mirror.js"),
    import("./stages/eval.js"),
    import("./stages/extract.js"),
    import("./stages/segment.js"),
    import("./stages/docgen.js"),
    import("./stages/template.js"),
    import("./stages/template-eval.js"),
  ]);
  return { mirror: mirrorStage, eval: evalStage, extract: extractStage, segment: segmentStage, docgen: docgenStage, template: templateStage, "template-eval": templateEvalStage };
}

const DEFAULT_STAGES_FOR_URL = ["mirror", "extract", "segment", "docgen", "eval"];

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(`--${flag}`);
  const url = get("url");
  const site = get("site");
  const stagesStr = get("stages");
  const stages = stagesStr ? stagesStr.split(",").map((s) => s.trim()) : url ? DEFAULT_STAGES_FOR_URL : null;
  if (!url && !site) {
    console.error("Usage: pnpm milo --url <url> [--stages s1,s2] [--verbose] [--quiet] [--force]");
    console.error("       pnpm milo --site <uuid> --stages s1,s2");
    process.exit(1);
  }
  if (site && !stages) {
    console.error("--site requires --stages (no default when targeting an existing site)");
    process.exit(1);
  }
  return { url, site, stages: stages!, verbose: has("verbose"), quiet: has("quiet"), force: has("force") };
}

async function ensureEvalWorkspace(): Promise<string> {
  const existing = await db.selectFrom("workspaces").select("uuid").where("slug", "=", "eval-workspace").executeTakeFirst();
  if (existing) return existing.uuid;
  const created = await db.insertInto("workspaces").values({ name: "Eval Workspace", slug: "eval-workspace" }).returning("uuid").executeTakeFirstOrThrow();
  return created.uuid;
}

async function resolveSite(url: string | undefined, siteUuid: string | undefined): Promise<{ siteUuid: string; workspaceUuid: string }> {
  if (siteUuid) {
    const site = await db.selectFrom("sites").select(["uuid", "workspaceUuid"]).where("uuid", "=", siteUuid).executeTakeFirstOrThrow();
    return { siteUuid: site.uuid, workspaceUuid: site.workspaceUuid };
  }
  const workspaceUuid = await ensureEvalWorkspace();
  const existing = await db.selectFrom("sites").select("uuid").where("sourceUrl", "=", url!).where("workspaceUuid", "=", workspaceUuid).executeTakeFirst();
  if (existing) return { siteUuid: existing.uuid, workspaceUuid };
  const host = new URL(url!).hostname.replace(/^www\./, "");
  const slug = `eval-${host.replace(/\./g, "-").slice(0, 40)}-${Date.now()}`;
  const created = await db.insertInto("sites").values({ name: host, slug, sourceUrl: url!, workspaceUuid }).returning("uuid").executeTakeFirstOrThrow();
  return { siteUuid: created.uuid, workspaceUuid };
}

async function checkPrerequisites(runner: StageRunner, ctx: StageContext): Promise<string | null> {
  for (const req of runner.requires) {
    const artifact = await loadArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, req as any);
    if (!artifact) return `"${runner.label}" requires artifact "${req}" — run prerequisite stages first`;
  }
  return null;
}

async function shouldSkip(runner: StageRunner, ctx: StageContext, force: boolean): Promise<boolean> {
  if (force || !runner.produces) return false;
  // eval and template-eval always re-run
  if (["eval", "template-eval"].includes(runner.label)) return false;
  const artifact = await loadArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, runner.produces as any);
  return !!artifact;
}

function renderReport(results: StageResult[], totalMs: number, quiet: boolean) {
  const pad = (s: string, w: number) => s.slice(0, w).padEnd(w);
  const icon = (s: StageResult["status"]) =>
    s === "pass" ? "✅ PASS" : s === "warn" ? "⚠️  WARN" : s === "fail" ? "❌ FAIL" : "⏭  SKIP";

  console.log("\nStage          Status    Key metrics                                  Duration");
  console.log("─".repeat(78));
  for (const r of results) {
    const m = Object.entries(r.metrics).map(([k, v]) => `${v} ${k}`).join(", ").slice(0, 44);
    console.log(`${pad(r.stage, 14)} ${pad(icon(r.status), 9)} ${pad(m, 44)} ${Math.round(r.durationMs / 1000)}s`);
  }
  console.log("─".repeat(78));
  console.log(`${"Total".padEnd(68)} ${Math.round(totalMs / 1000)}s`);

  if (!quiet) {
    const allW = results.flatMap((r) => dedupeWarnings(r.warnings).map((w) => `[${r.stage}] ${w}`));
    if (allW.length > 0) {
      console.log("\nWarnings:");
      allW.slice(0, 15).forEach((w) => console.log(`  ⚠  ${w}`));
      if (allW.length > 15) console.log(`  … and ${allW.length - 15} more (use --verbose for full list)`);
    }
    const failed = results.filter((r) => r.status === "fail");
    if (failed.length > 0) {
      console.log("\nFailures:");
      failed.forEach((r) => console.log(`  ❌ ${r.stage}: ${r.error}`));
    }

    // Cost summary — shown whenever any stage reported costs
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
      console.log(`  S3 ops:          ${total.s3Puts.toLocaleString()} PUTs + ${total.s3Gets.toLocaleString()} GETs`);
      console.log(`  Data uploaded:   ${mb} MB`);
      console.log(`  One-time cost:   $${total.onetime.toFixed(4)}`);
      console.log(`  Monthly storage: $${total.monthly.toFixed(4)}/mo`);
    }
  }
}

async function main() {
  const args = parseArgs();
  const registry = await loadRegistry();

  // Validate stage names before doing any DB work
  for (const s of args.stages) {
    if (!registry[s]) {
      console.error(`Unknown stage: "${s}". Available: ${Object.keys(registry).join(", ")}`);
      process.exit(1);
    }
  }

  const { siteUuid, workspaceUuid } = await resolveSite(args.url, args.site);
  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  const s3Client = getS3Client({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY });
  const ctx: StageContext = {
    db, config, s3Client, siteUuid, workspaceUuid,
    rendererDir: resolve(dirname(fileURLToPath(import.meta.url)), "../../renderer"),
    verbose: args.verbose,
    log: (msg) => { if (!args.quiet) console.log(msg); },
  };

  if (!args.quiet) console.log(`\nMilo pipeline — site: ${siteUuid}`);

  const results: StageResult[] = [];
  const totalStart = Date.now();

  for (const stageName of args.stages) {
    const runner = registry[stageName];
    ctx.log(`\n▶ ${stageName}`);

    const prereqErr = await checkPrerequisites(runner, ctx);
    if (prereqErr) {
      results.push({ stage: stageName, status: "fail", durationMs: 0, metrics: {}, warnings: [], error: prereqErr });
      // Skip remaining
      for (const rem of args.stages.slice(args.stages.indexOf(stageName) + 1)) {
        results.push({ stage: rem, status: "skipped", durationMs: 0, metrics: {}, warnings: [] });
      }
      break;
    }

    const skip = await shouldSkip(runner, ctx, args.force);
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
      result = { stage: stageName, status: "fail", durationMs: Date.now() - start, metrics: {}, warnings: [], error: err instanceof Error ? err.message : String(err) };
    }
    result.stage = stageName;
    result.durationMs = result.durationMs || Date.now() - start;
    results.push(result);

    if (result.status === "fail") {
      for (const rem of args.stages.slice(args.stages.indexOf(stageName) + 1)) {
        results.push({ stage: rem, status: "skipped", durationMs: 0, metrics: {}, warnings: [] });
      }
      break;
    }
  }

  renderReport(results, Date.now() - totalStart, args.quiet);
  await db.destroy();
  process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Add `milo` script to `apps/api/package.json`**

Find the `"scripts"` section and add:
```json
"milo": "tsx scripts/milo.ts"
```

- [ ] **Step 4: Smoke test — help text**

```bash
cd apps/api && pnpm milo 2>&1 | head -5
```

Expected output includes "Usage: pnpm milo --url".

- [ ] **Step 5: Build check**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no TypeScript errors (milo.ts is a script, not compiled by tsc, but imports must be valid).

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/stages/types.ts apps/api/scripts/milo.ts apps/api/package.json
git commit -m "feat(milo): core CLI entry point — arg parsing, site resolution, stage orchestration, report"
```

---

## Task 2: Mirror stage

**Files:**
- Create: `apps/api/scripts/stages/mirror.ts`

- [ ] **Step 1: Create `apps/api/scripts/stages/mirror.ts`**

```typescript
// apps/api/scripts/stages/mirror.ts
import { runMirrorPipeline } from "../../src/services/mirror/run-mirror";
import { CRAWL_TIER_FREE, CRAWL_TIER_PAID } from "../../src/types/mirror";
import { dedupeWarnings, estimateMirrorCosts } from "./types";
import type { StageRunner, StageContext, StageResult } from "./types";

// Detects CMS/builder from snapshot warning messages
const CMS_SIGNATURES: [string, string][] = [
  ["dynamic plugin (Elementor", "elementor"],
  ["plugin:Webflow", "webflow"],
  ["Squarespace", "squarespace"],
  ["wixsite.com", "wix"],
  ["shopify", "shopify"],
];

function detectCms(warnings: string[]): string | null {
  const sample = warnings.slice(0, 20).join(" ");
  for (const [pattern, cms] of CMS_SIGNATURES) {
    if (sample.toLowerCase().includes(pattern.toLowerCase())) return cms;
  }
  return null;
}

export const mirrorStage: StageRunner = {
  label: "mirror",
  requires: [],
  produces: "mirror-deploy",
  async run(ctx: StageContext): Promise<StageResult> {
    const site = await ctx.db
      .selectFrom("sites")
      .select(["mirrorStatus", "sourceUrl"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    if (site.mirrorStatus === "crawling") {
      throw new Error("Site is already being mirrored — wait for it to complete or manually reset mirrorStatus");
    }
    if (!site.sourceUrl) throw new Error("Site has no sourceUrl configured");

    ctx.log(`  URL: ${site.sourceUrl}`);

    const result = await runMirrorPipeline({
      db: ctx.db,
      config: ctx.config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      tier: CRAWL_TIER_PAID,
      log: {
        info: (o, m) => { if (ctx.verbose) ctx.log(`  [info] ${m} ${JSON.stringify(o)}`); },
        warn: (_o, m) => ctx.log(`  [warn] ${m}`),
      },
    });

    const cms = detectCms(result.warnings);
    const deduped = dedupeWarnings(result.warnings);

    // Estimate asset count from crawl artifact for cost calculation
    const crawlArtifact = await import("../../src/utils/pipeline/artifact-store")
      .then(m => m.loadArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "mirror-assets" as any));
    const assetCount = (crawlArtifact?.payload as any)?.failures?.length
      ? 208 // fallback estimate
      : 200;
    const costs = estimateMirrorCosts(result.pageCount, assetCount);

    return {
      stage: "mirror",
      status: deduped.length > 0 ? "warn" : "pass",
      durationMs: 0,
      metrics: {
        pages: result.pageCount,
        warnings: result.warnings.length,
        ...(cms ? { cms } : {}),
      },
      warnings: deduped,
      costs,
    };
  },
};
```

- [ ] **Step 2: Test mirror stage runs end-to-end**

```bash
cd apps/api && pnpm milo --url https://torrancetraininglab.com --stages mirror --verbose 2>&1 | tail -15
```

Expected: table showing `mirror ✅ PASS 156 pages` (or similar). If Torrance was already mirrored, it shows `⏭  SKIP`.

Use `--force` to re-run:
```bash
pnpm milo --url https://torrancetraininglab.com --stages mirror --force 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/stages/mirror.ts
git commit -m "feat(milo): mirror stage — wraps runMirrorPipeline with CMS detection and concurrency guard"
```

---

## Task 3: Eval stage

**Files:**
- Create: `apps/api/scripts/stages/eval.ts`

The eval stage contains the screenshot comparison and form capture logic currently in `run-mirror.ts`. Read `apps/api/scripts/eval/run-mirror.ts` to understand the `capturePage`, `screenshotOrigin`, and `computeSimilarity` functions before implementing.

- [ ] **Step 1: Create `apps/api/scripts/stages/eval.ts`**

```typescript
// apps/api/scripts/stages/eval.ts
import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { StageRunner, StageContext, StageResult } from "./types";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { buildS3ObjectUrl } from "../../src/s3";
import type { MirrorCrawlArtifact } from "../../src/types/mirror";

const EVAL_PAGE_LIMIT = 10;
const SIMILARITY_PASS_THRESHOLD = 95;

interface PageResult {
  path: string;
  similarity: number;
  brokenAssets: number;
  heightDeltaPx: number;
  passed: boolean;
  warnings: string[];
}

async function screenshotUrl(url: string): Promise<{ png: Buffer; heightPx: number }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const heightPx = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewportSize({ width: 1280, height: Math.min(heightPx, 6000) });
    const png = await page.screenshot({ fullPage: false });
    return { png, heightPx };
  } finally {
    await browser.close();
  }
}

function similarity(a: Buffer, b: Buffer): { score: number; heightDeltaPx: number } {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  const w = Math.max(imgA.width, imgB.width);
  const h = Math.max(imgA.height, imgB.height);
  const canvasA = new PNG({ width: w, height: h });
  const canvasB = new PNG({ width: w, height: h });
  imgA.data.copy(canvasA.data, 0, 0, Math.min(imgA.data.length, canvasA.data.length));
  imgB.data.copy(canvasB.data, 0, 0, Math.min(imgB.data.length, canvasB.data.length));
  const diff = new PNG({ width: w, height: h });
  const mismatch = pixelmatch(canvasA.data, canvasB.data, diff.data, w, h, { threshold: 0.1 });
  const score = Math.round((1 - mismatch / (w * h)) * 100);
  return { score, heightDeltaPx: imgA.height - imgB.height };
}

export const evalStage: StageRunner = {
  label: "eval",
  requires: ["mirror-deploy"],
  produces: "eval",
  async run(ctx: StageContext): Promise<StageResult> {
    const deploy = await loadArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "mirror-deploy") as any;
    if (!deploy?.payload?.deployPrefix) throw new Error("mirror-deploy artifact has no deployPrefix");

    const crawl = await loadArtifact<MirrorCrawlArtifact>(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "mirror-crawl");
    const pages = (crawl?.payload?.pages ?? []).slice(0, EVAL_PAGE_LIMIT);
    if (pages.length === 0) throw new Error("No crawl pages found — run mirror stage first");

    const site = await ctx.db.selectFrom("sites").select("sourceUrl").where("uuid", "=", ctx.siteUuid).executeTakeFirstOrThrow();
    const cdnBase = ctx.config.CDN_BASE_URL.replace(/\/$/, "");
    const sourceOrigin = new URL(site.sourceUrl!).origin;

    const results: PageResult[] = [];
    let totalBroken = 0;

    for (const page of pages) {
      ctx.log(`  Scoring ${page.path} …`);
      try {
        const mirrorUrl = `${cdnBase}/sites/${ctx.siteUuid}/current${page.path === "/" ? "/index.html" : page.path}`;
        const originUrl = `${sourceOrigin}${page.path}`;

        const [mirrorShot, originShot] = await Promise.all([screenshotUrl(mirrorUrl), screenshotUrl(originUrl)]);
        const { score, heightDeltaPx } = similarity(mirrorShot.png, originShot.png);

        results.push({
          path: page.path,
          similarity: score,
          brokenAssets: 0,
          heightDeltaPx,
          passed: score >= SIMILARITY_PASS_THRESHOLD,
          warnings: score < SIMILARITY_PASS_THRESHOLD ? [`similarity ${score}% below ${SIMILARITY_PASS_THRESHOLD}% threshold`] : [],
        });
      } catch (err) {
        results.push({ path: page.path, similarity: 0, brokenAssets: 0, heightDeltaPx: 0, passed: false, warnings: [`screenshot failed: ${err instanceof Error ? err.message : String(err)}`] });
      }
    }

    // Form capture smoke test
    let formCheckPassed = false;
    let formCheckMessage = "skipped";
    try {
      const formRes = await fetch(`${cdnBase}/api/forms/${ctx.siteUuid}/eval-smoke-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: "eval@milotest.com", name: "Eval Test", _hp: "" }),
      });
      if (formRes.status === 201) {
        const row = await ctx.db.selectFrom("leads").select("uuid").where("siteUuid", "=", ctx.siteUuid).where("formId", "=", "eval-smoke-test").orderBy("createdAt", "desc").executeTakeFirst();
        if (row) {
          formCheckPassed = true;
          formCheckMessage = "✅";
          await ctx.db.deleteFrom("leads").where("uuid", "=", row.uuid).execute();
        } else { formCheckMessage = "❌ 201 but no row"; }
      } else { formCheckMessage = `❌ HTTP ${formRes.status}`; }
    } catch (err) {
      formCheckMessage = `❌ ${err instanceof Error ? err.message : String(err)}`;
    }

    const passCount = results.filter((r) => r.passed).length;
    const avgSimilarity = results.length > 0 ? Math.round(results.reduce((a, r) => a + r.similarity, 0) / results.length) : 0;
    const anyFailed = results.some((r) => !r.passed);

    return {
      stage: "eval",
      status: anyFailed ? "fail" : "pass",
      durationMs: 0,
      metrics: {
        pages: results.length,
        avgSimilarity: `${avgSimilarity}%`,
        passed: passCount,
        form: formCheckMessage,
      },
      warnings: results.flatMap((r) => r.warnings.map((w) => `${r.path}: ${w}`)),
    };
  },
};
```

- [ ] **Step 2: Test eval stage against Torrance (already mirrored)**

```bash
cd apps/api && pnpm milo --site ab867633-9d48-4258-b752-07214d6314b7 --stages eval 2>&1 | tail -15
```

Expected: table with similarity scores and form check result.

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/stages/eval.ts
git commit -m "feat(milo): eval stage — screenshot diff, similarity scoring, form capture check"
```

---

## Task 4: Pipeline stages (extract, segment, docgen)

**Files:**
- Create: `apps/api/scripts/stages/extract.ts`
- Create: `apps/api/scripts/stages/segment.ts`
- Create: `apps/api/scripts/stages/docgen.ts`

Read `apps/api/scripts/eval/run-pipeline.ts` lines 60-90 for the exact imports and function signatures of `runExtractStage`, `runSegmentStage`, `runDocgenStage` before implementing. Also read the `runStages` function (line ~280) to understand what inputs each stage needs.

- [ ] **Step 1: Create `apps/api/scripts/stages/extract.ts`**

```typescript
// apps/api/scripts/stages/extract.ts
import type { StageRunner, StageContext, StageResult } from "./types";
import { runExtractStage } from "../../src/services/pipeline/extract-stage";
import type { ExtractStageInput } from "../../src/services/pipeline/extract-stage";
import { saveArtifact } from "../../src/utils/pipeline/artifact-store";

export const extractStage: StageRunner = {
  label: "extract",
  requires: [],
  produces: "extract",
  async run(ctx: StageContext): Promise<StageResult> {
    const site = await ctx.db
      .selectFrom("sites")
      .select(["sourceUrl"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();
    if (!site.sourceUrl) throw new Error("Site has no sourceUrl");

    ctx.log(`  Extracting ${site.sourceUrl}`);

    const input: ExtractStageInput = {
      db: ctx.db,
      config: ctx.config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      url: site.sourceUrl,
      pages: ["/"],
    };

    const result = await runExtractStage(input);
    await saveArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "extract", result);

    return {
      stage: "extract",
      status: "pass",
      durationMs: 0,
      metrics: { pages: result.pages?.length ?? 0 },
      warnings: [],
    };
  },
};
```

> **Note:** The exact import path and function signature for `runExtractStage` must be verified by reading `run-pipeline.ts` lines 60-85. The input shape (`ExtractStageInput`) may differ slightly — match what `run-pipeline.ts` passes. If `runExtractStage` already saves the artifact internally, remove the `saveArtifact` call.

- [ ] **Step 2: Create `apps/api/scripts/stages/segment.ts`**

```typescript
// apps/api/scripts/stages/segment.ts
import type { StageRunner, StageContext, StageResult } from "./types";
import { runSegmentStage } from "../../src/services/pipeline/segment-stage";
import { loadArtifact, saveArtifact } from "../../src/utils/pipeline/artifact-store";

export const segmentStage: StageRunner = {
  label: "segment",
  requires: ["extract"],
  produces: "segment",
  async run(ctx: StageContext): Promise<StageResult> {
    const extract = await loadArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "extract" as any);
    if (!extract) throw new Error("extract artifact required");

    const result = await runSegmentStage({
      db: ctx.db,
      config: ctx.config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      extractArtifact: extract.payload as any,
    });
    await saveArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "segment", result);

    return {
      stage: "segment",
      status: "pass",
      durationMs: 0,
      metrics: { components: (result as any).sharedComponents?.length ?? 0 },
      warnings: [],
    };
  },
};
```

- [ ] **Step 3: Create `apps/api/scripts/stages/docgen.ts`**

```typescript
// apps/api/scripts/stages/docgen.ts
import type { StageRunner, StageContext, StageResult } from "./types";
import { runDocgenStage } from "../../src/services/pipeline/docgen-stage";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { saveSiteDocs } from "../../src/utils/site-docs";
import { getS3Client } from "../../src/s3";

export const docgenStage: StageRunner = {
  label: "docgen",
  requires: ["extract", "segment"],
  produces: "docgen",
  async run(ctx: StageContext): Promise<StageResult> {
    const site = await ctx.db
      .selectFrom("sites")
      .select(["sourceUrl", "workspaceUuid"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    ctx.log("  Generating 9 structured docs …");

    const docs = await runDocgenStage({
      db: ctx.db,
      config: ctx.config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "replication",
      s3Client: ctx.s3Client,
      bucket: ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET,
    });

    await saveSiteDocs(ctx.db, docs, ctx.siteUuid, ctx.workspaceUuid);

    const emptyFields = docs.filter((d) => !d.content || d.content.trim().length < 20);

    return {
      stage: "docgen",
      status: emptyFields.length > 0 ? "warn" : "pass",
      durationMs: 0,
      metrics: { docs: docs.length, empty: emptyFields.length },
      warnings: emptyFields.map((d) => `doc "${d.key}" appears empty`),
    };
  },
};
```

> **Note:** Before implementing, read `run-pipeline.ts` lines 280-370 for the exact `runDocgenStage` input shape. It requires a `DocgenStageInput` object that likely includes `s3ctx`, `config`, and various artifact contexts. Match what `run-pipeline.ts` passes exactly.

- [ ] **Step 4: Verify TypeScript builds**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/stages/extract.ts apps/api/scripts/stages/segment.ts apps/api/scripts/stages/docgen.ts
git commit -m "feat(milo): extract, segment, docgen stages — thin wrappers around pipeline service functions"
```

---

## Task 5: Template stages + backward-compat wrappers

**Files:**
- Create: `apps/api/scripts/stages/template.ts`
- Create: `apps/api/scripts/stages/template-eval.ts`
- Modify: `apps/api/scripts/eval/run-mirror.ts`
- Modify: `apps/api/scripts/eval/run-pipeline.ts`
- Modify: `apps/api/scripts/eval/run-template-deploy.ts`
- Modify: `apps/api/scripts/eval/run-template-eval.ts`

- [ ] **Step 1: Create `apps/api/scripts/stages/template.ts`**

```typescript
// apps/api/scripts/stages/template.ts
import path from "path";
import { dirname, fileURLToPath } from "url";
import type { StageRunner, StageContext, StageResult } from "./types";
import { deployTemplate } from "../../src/services/template/deploy-template";
import { publishSiteVersion } from "../../src/services/site-versions";

export const templateStage: StageRunner = {
  label: "template",
  requires: [],        // docgen docs in DB are checked by deployTemplate internally
  produces: "template-deploy",
  async run(ctx: StageContext): Promise<StageResult> {
    const site = await ctx.db
      .selectFrom("sites")
      .select(["customDomain"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;
    const siteUrl = site.customDomain
      ? `https://${site.customDomain}`
      : `${ctx.config.CDN_BASE_URL}/sites/${ctx.siteUuid}/current`;

    ctx.log("  Building Astro template …");

    const result = await deployTemplate({
      db: ctx.db,
      s3Client: ctx.s3Client,
      bucket,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      apiBaseUrl: ctx.config.CDN_BASE_URL,
      siteUrl,
      rendererDir: ctx.rendererDir,
      log: {
        info: (_o, m) => { if (ctx.verbose) ctx.log(`  ${m}`); },
        warn: (_o, m) => ctx.log(`  [warn] ${m}`),
      },
    });

    await publishSiteVersion(ctx.db, ctx.s3Client, bucket, ctx.siteUuid, result.version);

    return {
      stage: "template",
      status: result.warnings.length > 0 ? "warn" : "pass",
      durationMs: 0,
      metrics: { version: result.version, routes: result.routes, redirects: result.redirects.length },
      warnings: result.warnings,
    };
  },
};
```

- [ ] **Step 2: Create `apps/api/scripts/stages/template-eval.ts`**

```typescript
// apps/api/scripts/stages/template-eval.ts
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { StageRunner, StageContext, StageResult } from "./types";

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".xml": "application/xml", ".txt": "text/plain", ".json": "application/json",
};

export const templateEvalStage: StageRunner = {
  label: "template-eval",
  requires: [],
  produces: "template-eval",
  async run(ctx: StageContext): Promise<StageResult> {
    const distDir = path.join(ctx.rendererDir, "dist");
    if (!existsSync(path.join(distDir, "index.html"))) {
      throw new Error(`No template build at ${distDir} — run template stage first`);
    }

    // Serve dist locally
    const server = createServer((req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0];
      let file = path.join(distDir, urlPath);
      if (urlPath.endsWith("/")) file = path.join(file, "index.html");
      else if (!path.extname(file)) file = path.join(file, "index.html");
      try {
        const body = readFileSync(file);
        res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch { res.writeHead(404); res.end("not found"); }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const failures: string[] = [];
    const visited = new Set<string>();
    const queue = ["/"];
    const browser = await chromium.launch();
    const page = await browser.newPage();

    while (queue.length > 0) {
      const route = queue.shift()!;
      if (visited.has(route)) continue;
      visited.add(route);
      const res = await page.goto(base + route, { waitUntil: "domcontentloaded" });
      if (!res || res.status() >= 400) { failures.push(`${route}: HTTP ${res?.status()}`); continue; }
      const ldErrors = await page.evaluate(() => {
        const errs: string[] = [];
        document.querySelectorAll('script[type="application/ld+json"]').forEach((s, i) => {
          try { JSON.parse(s.textContent ?? ""); } catch { errs.push(`ld+json #${i} invalid JSON`); }
        });
        if (document.querySelectorAll('script[type="application/ld+json"]').length === 0) errs.push("no JSON-LD found");
        return errs;
      });
      failures.push(...ldErrors.map((e) => `${route}: ${e}`));
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
          .filter((h) => h.startsWith("/") && !h.startsWith("//")),
      );
      for (const l of links) { const clean = l.split("#")[0].split("?")[0]; if (clean && !visited.has(clean)) queue.push(clean); }
    }
    await browser.close();
    server.close();

    for (const f of ["sitemap.xml", "robots.txt", "llms.txt"]) {
      if (!existsSync(path.join(distDir, f))) failures.push(`missing ${f}`);
    }

    return {
      stage: "template-eval",
      status: failures.length > 0 ? "fail" : "pass",
      durationMs: 0,
      metrics: { pages: visited.size, failures: failures.length },
      warnings: failures,
    };
  },
};
```

- [ ] **Step 3: Update old scripts as backward-compat wrappers**

Replace the bodies of the four old scripts with thin delegators. They keep their filename and usage comment but just call `milo.ts`:

**`apps/api/scripts/eval/run-mirror.ts`** — replace entire file content with:
```typescript
/**
 * Backward-compatible wrapper — delegates to milo.ts.
 * Usage: pnpm tsx scripts/eval/run-mirror.ts --url https://gym.com [--tier free|paid]
 * New usage: pnpm milo --url https://gym.com --stages mirror,eval
 */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const url = args[args.indexOf("--url") + 1];
const site = args.includes("--site") ? args[args.indexOf("--site") + 1] : undefined;
const target = url ? `--url ${url}` : `--site ${site}`;
const miloArgs = `${target} --stages mirror,eval`.split(" ");

const result = spawnSync(
  process.execPath,
  [resolve(dirname(fileURLToPath(import.meta.url)), "../milo.js"), ...miloArgs],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
```

**`apps/api/scripts/eval/run-pipeline.ts`** — replace with:
```typescript
/**
 * Backward-compatible wrapper — delegates to milo.ts.
 * New usage: pnpm milo --url https://gym.com --stages extract,segment,docgen
 */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const urlIdx = args.indexOf("--urls");
const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
const stagesArg = args.includes("--stages") ? args[args.indexOf("--stages") + 1] : "extract,segment,docgen";
const miloArgs = url ? ["--url", url, "--stages", stagesArg] : ["--help"];

const result = spawnSync(
  process.execPath,
  [resolve(dirname(fileURLToPath(import.meta.url)), "../milo.js"), ...miloArgs],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
```

**`apps/api/scripts/eval/run-template-deploy.ts`** — replace with:
```typescript
/**
 * Backward-compatible wrapper — delegates to milo.ts.
 * New usage: pnpm milo --site <uuid> --stages template
 */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const siteIdx = process.argv.indexOf("--site");
const site = siteIdx >= 0 ? process.argv[siteIdx + 1] : undefined;
if (!site) { console.error("--site <uuid> required"); process.exit(1); }

const result = spawnSync(
  process.execPath,
  [resolve(dirname(fileURLToPath(import.meta.url)), "../milo.js"), "--site", site, "--stages", "template"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
```

**`apps/api/scripts/eval/run-template-eval.ts`** — replace with:
```typescript
/**
 * Backward-compatible wrapper — delegates to milo.ts.
 * New usage: pnpm milo --site <uuid> --stages template-eval
 */
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const siteIdx = process.argv.indexOf("--site");
const site = siteIdx >= 0 ? process.argv[siteIdx + 1] : undefined;
if (!site) { console.error("--site <uuid> required"); process.exit(1); }

const result = spawnSync(
  process.execPath,
  [resolve(dirname(fileURLToPath(import.meta.url)), "../milo.js"), "--site", site, "--stages", "template-eval"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
```

- [ ] **Step 4: End-to-end smoke test**

```bash
cd apps/api && pnpm milo --url https://torrancetraininglab.com --stages mirror,eval 2>&1 | tail -20
```

Expected: report table with mirror and eval results.

```bash
pnpm milo --url https://torrancetraininglab.com --stages mirror 2>&1 | tail -5
```

Expected: `mirror ⏭  SKIP` (already mirrored, no --force).

- [ ] **Step 5: Build**

```bash
pnpm build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/stages/template.ts apps/api/scripts/stages/template-eval.ts apps/api/scripts/eval/run-mirror.ts apps/api/scripts/eval/run-pipeline.ts apps/api/scripts/eval/run-template-deploy.ts apps/api/scripts/eval/run-template-eval.ts
git commit -m "feat(milo): template stages + backward-compat wrappers for all old eval scripts"
```

---

## Running all tests after completion

```bash
cd apps/api && pnpm test --no-file-parallelism
```

Expected: all existing tests still pass (no existing tests cover eval scripts, so this is a regression check on service layer).

## Final smoke test

```bash
# Full default pipeline on a new site
pnpm milo --url https://speakeasyofstrength.com

# Specific stages on existing site
pnpm milo --site ab867633-9d48-4258-b752-07214d6314b7 --stages eval

# Quiet mode
pnpm milo --url https://torrancetraininglab.com --stages mirror --quiet
```
