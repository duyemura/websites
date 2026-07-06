# Unified Pipeline CLI (`milo`) — Design

**Date:** 2026-07-06
**Status:** Approved for planning

## Goal

Replace four separate eval scripts with one composable CLI where every stage produces a measurable `StageResult` and the operator can run any subset of stages against any site.

## The problem today

| Script | Handles | Problem |
|---|---|---|
| `run-mirror.ts` | mirror + eval | 462 lines, no stage skipping, re-crawls even if already mirrored |
| `run-pipeline.ts` | extract/segment/docgen/build/verify | 719 lines, already has `--stages`, not connected to mirror |
| `run-template-deploy.ts` | template deploy | 60 lines, separate, no report |
| `run-template-eval.ts` | template quality | 100 lines, separate, no report |

None share a unified output format. None skip stages when artifacts already exist.

---

## Stages

Eight stages in order. Each is independently runnable.

| Stage | What it does | Output artifact | Pass criteria |
|---|---|---|---|
| `mirror` | Crawl + capture all assets + snapshot + deploy to S3/CloudFront | `mirror-crawl`, `mirror-assets`, `mirror-snapshot`, `mirror-deploy` | ≥1 page captured, 0 broken same-origin assets |
| `extract` | Playwright scrape for structured content (headings, nav, sections, colors) | `extract` pipeline artifact | ≥1 page extracted |
| `segment` | Identify shared components and section patterns | `segment` pipeline artifact | ≥1 section identified |
| `docgen` | Generate 9 structured docs (design-system, business-info, site-hierarchy, etc.) | 9 rows in `docs` table | All 9 doc keys present |
| `eval` | Screenshot diff + pixel similarity + form capture smoke test | eval report `.md` | Similarity ≥95%, 0 broken assets, form ✅ |
| `audit` | Opportunity scanner — find SEO, conversion, capture gaps | `site-audit` artifact | Completes without error |
| `template` | Build + deploy Astro template from docs | template deploy prefix | ≥1 route built |
| `template-eval` | Screenshot diff of template vs. source | template eval report `.md` | Similarity ≥80% |

---

## CLI interface

Single entry point: `apps/api/scripts/milo.ts`

```bash
# New site — mirror + docs + eval (default)
pnpm milo --url https://speakeasyofstrength.com

# New site — mirror only
pnpm milo --url https://gym.com --stages mirror

# Existing site — run docs without re-mirroring
pnpm milo --site <uuid> --stages extract,segment,docgen

# Existing site — just re-score
pnpm milo --site <uuid> --stages eval

# Full pipeline
pnpm milo --url https://gym.com --stages mirror,extract,segment,docgen,eval,audit

# Force re-run even if artifacts exist
pnpm milo --site <uuid> --stages docgen --force

# Upgrade to Managed template
pnpm milo --site <uuid> --stages template,template-eval
```

**Default stages** when `--url` is given: `mirror,extract,segment,docgen,eval`

**`--site` requires stages** — no default, since we don't know what already exists.

---

## Stage result shape

Every stage returns a `StageResult`:

```typescript
interface StageResult {
  stage: string;
  status: "pass" | "warn" | "fail" | "skipped";
  durationMs: number;
  metrics: Record<string, number | string | boolean>;
  warnings: string[];
  error?: string;
}
```

The unified report prints a table at the end:

```
Stage          Status   Key metrics                            Duration
─────────────────────────────────────────────────────────────────────
mirror         ✅ PASS  156 pages, 0 broken assets            253s
extract        ✅ PASS  156 pages extracted                    41s
segment        ✅ PASS  23 shared components                    8s
docgen         ⚠️ WARN  9 docs created, phone not found        12s
eval           ✅ PASS  99% similarity, form ✅                 38s
audit          ✅ PASS  8 issues (3 high, 5 medium)             1s
─────────────────────────────────────────────────────────────────────
Total                                                          353s
```

Warnings are listed below the table. Failures stop the pipeline (subsequent stages are skipped and marked `skipped`).

---

## Resume behavior

Before running a stage, check if its primary artifact already exists in the DB. If it does and `--force` is not passed, skip it and return `{ status: "skipped" }`.

| Stage | Artifact checked |
|---|---|
| `mirror` | `mirror-deploy` artifact for this siteUuid |
| `extract` | `extract` pipeline artifact |
| `segment` | `segment` pipeline artifact |
| `docgen` | All 9 doc keys present in `docs` table |
| `eval` | Always re-runs (scoring is cheap, output changes if mirror changed) |
| `audit` | `site-audit` artifact |
| `template` | Latest `site_versions` row with `kind: "template"` |
| `template-eval` | Always re-runs |

---

## Architecture

```
apps/api/scripts/
  milo.ts                    ← entry point: parse args, resolve site, run stages, print report
  stages/
    mirror.ts                ← extracted from run-mirror.ts (mirror pipeline only)
    extract.ts               ← extracted from run-pipeline.ts
    segment.ts               ← extracted from run-pipeline.ts
    docgen.ts                ← extracted from run-pipeline.ts
    eval.ts                  ← extracted from run-mirror.ts (scoring only)
    audit.ts                 ← new (uses site-audit service)
    template.ts              ← extracted from run-template-deploy.ts
    template-eval.ts         ← extracted from run-template-eval.ts
  eval/                      ← OLD scripts kept as thin wrappers (backward compat)
    run-mirror.ts            ← calls milo --stages mirror,eval
    run-pipeline.ts          ← calls milo --stages extract,segment,docgen,build,verify
    run-template-deploy.ts   ← calls milo --stages template
    run-template-eval.ts     ← calls milo --stages template-eval
```

The old scripts become one-liners that delegate to `milo.ts`. No functionality is deleted — just reorganized.

---

## Site resolution

Given `--url https://gym.com`:
1. Look up existing site by `sourceUrl` — if found, reuse it
2. If not found, create a new site record (workspace = eval workspace)

Given `--site <uuid>`:
1. Load site record directly

In both cases, `workspaceUuid` comes from the site record (or the eval workspace default).

---

## Extensibility

Adding a new stage (e.g., `audit` later) requires:
1. Create `stages/audit.ts` implementing `runAuditStage(ctx): Promise<StageResult>`
2. Add to the stage registry in `milo.ts`
3. Immediately available as `--stages audit`

No changes to the CLI parser or report formatter.

---

## Error handling

- A stage that throws is marked `fail` with `error` field
- Subsequent stages are skipped (status: `skipped`)
- `--continue-on-fail` flag overrides this and runs all requested stages regardless
- The process exits with code 1 if any stage failed

---

## Out of scope

- Browser UI / dashboard (this is a CLI tool)
- Parallel stage execution (stages run sequentially, dependencies require it)
- Webhook notifications when stages complete (that's the API worker's job)
