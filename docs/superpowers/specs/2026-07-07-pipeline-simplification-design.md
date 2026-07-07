# Pipeline simplification design

**Date:** 2026-07-07
**Status:** Approved for implementation

## Context

The Milo pipeline grew organically and ended up with 12 registered stages, an unclear
join-vs-upgrade distinction, and a CLI that required knowing stage names to do basic
operations. This spec restructures the CLI around named commands that reflect the actual
product model, without changing any stage logic.

---

## Product model (canonical, never deviate)

Milo is a two-tier gym website platform. **A site is always one or the other — never both.**
**Never say "mirror" — it's always "clone."**

### Tier 1 — Hosted (free)

Gym joins → we run the full intelligence-gathering pipeline once → cloned site goes live.
Gym cancels their old host. **Milo is now the system of record. We never re-clone.**

```
enrich → clone → docgen → content
```

The cloned site serves from S3+CloudFront. Gym gets free hosting and the ability to edit
content via docs (manual or AI assistant).

### Tier 2 — Managed (paid)

Gym upgrades → we use the already-gathered docs to generate an Astro template site.
No re-clone. The docs gathered at join time are the input.

```
generate → template → publish
```

On upgrade, publish swaps the clone to rollback and promotes the template to live, emitting
a 301 redirect map for any URL changes.

### Hard rules

- **Clone runs once.** Never re-clone, never re-sync from the source site.
- **All changes go through Milo** — manual doc edits, AI assistant, or editor UI.
- **Docs are the single source of truth.** Any doc change → rebuild → live site reflects it.
- **`site-hierarchy` owns page structure.** Adding/removing/reordering pages = edit that doc.
- **Both tiers can add pages.** Tier 1: LLM generates HTML in clone's style (best-effort).
  Tier 2: Astro template renders structurally (consistent, reliable).
- **The upsell is quality and automation**, not capability gates. Tier 2 gives layout
  consistency, AI content loop (blog, pillars, keyword monitoring), GSC integration.

### Future — Delta preview

Run `generate → template` as a preview-only deploy against existing docs before the gym
commits to upgrading. No re-clone, shows exactly what upgrading produces.

---

## Docs as source of truth

The 9 structured docs in the DB capture everything needed to drive both tiers:

| Doc | Contains |
|-----|---------|
| `workspace-memory` | Business name, tagline, goal, positioning |
| `business-info` | Phone, email, address, hours, programs, team, testimonials, FAQs, social links |
| `brand-guidelines` | Colors, fonts, tone of voice, imagery style, copy examples |
| `site-hierarchy` | Page inventory, nav structure, section order |
| `site-strategy` | Conversion goal, page structure, build phases |
| `design-system` | CSS tokens, breakpoints, spacing |
| `search-presence` | Meta titles, descriptions, schema markup, keyword targets |
| `site-memory` | Site state, publish status, recent edits log |
| `section-visual-evidence` | Visual snapshots of sections |

Plus the `content` stage artifact: per-page briefs (hero headline, subheading, CTA,
testimonials, FAQ, value props) for each crawled page.

**Edit paths by tier:**

| Action | Tier 1 (clone) | Tier 2 (template) |
|--------|---------------|-------------------|
| Change copy, hours, contact | HTML transform applied to clone | `rebuild` → regenerated |
| Update nav | `milo nav` (nav-rebuild stage) | `rebuild` → regenerated |
| Add / remove pages | LLM generates page in clone's style | Edit `site-hierarchy` → `rebuild` |
| AI content loop (blog, SEO) | Not available | Tier 2 only |
| Guaranteed layout consistency | Not guaranteed (LLM best-effort) | Template enforces design system |

---

## CLI design

The `milo` CLI (`apps/api/scripts/milo.ts`) exposes named subcommands that map to the
product model. The granular `--stages` flag remains as an escape hatch for debugging.

### Pipeline commands

```
milo join    --url <url> [--theme x] [--tier free|paid] [--verbose] [--force]
```
Runs the join pipeline for a new gym. Creates a site record if one doesn't exist for the URL.
Stages: `enrich → clone → docgen → content`
Skip logic: stages with existing artifacts are skipped unless `--force` is passed.

```
milo upgrade --site <uuid> [--theme x] [--force] [--verbose]
```
Runs the upgrade pipeline for an existing gym moving to Tier 2.
Stages: `generate → template → publish`
Prereq check: fails immediately with a clear message if `docgen` + `content` artifacts are
missing. Error: `"Run milo join first — upgrade requires docs from the join pipeline."`

```
milo rebuild --site <uuid> [--force] [--verbose]
```
Same stages as upgrade (`generate → template → publish`). Signals intent: a doc changed,
push it live. Used by the edit system (manual edits, AI assistant) to trigger a site rebuild.
Only valid for Tier 2 sites (those where a `generate` artifact exists). Tier 1 sites use
HTML transforms, not rebuild. Milo detects tier by checking for a `generate` artifact — if
none exists, `milo rebuild` fails with: `"This site is on the clone plan. Use milo upgrade to
move to a template site first."`

```
milo page    --site <uuid> --path /slug [--force] [--verbose]
```
Generates a content brief for a single page. Scopes `content` stage to `--path` only and
merges the result into the existing `content` artifact (does not regenerate all pages).
After content runs: if Tier 2, automatically queues a `rebuild`.

**Tier 1 new page generation (not in scope of this spec):** For Tier 1 sites, generating a
new HTML page in the clone's style requires new logic — LLM reads docs + clone brand/design
and produces HTML. This is a separate feature, tracked separately. `milo page` on a Tier 1
site currently only generates the content brief (useful for future upgrade) and updates
`site-hierarchy`. The actual HTML generation for Tier 1 is a follow-on spec.

### Tool commands (not pipelines — no artifact chain, no skip logic)

```
milo eval    --site <uuid>                  # pixel-diff QA between source and clone
milo nav     --site <uuid>                  # rebuild nav from site-hierarchy doc
milo restore --site <uuid> --version <n>    # roll back to a prior site version
```

### Power-user escape hatch (unchanged)

```
milo --site <uuid> --stages enrich,docgen   # explicit stage list still works
```

### Removed from main CLI

The following stages are no longer reachable as first-class pipeline stages from the
default invocation. They are still in the stage registry and reachable via `--stages`:
- `template-eval` → use `--stages template-eval` for debugging
- `extract`, `segment`, `contract` → vision track, experimental, `--stages` only

---

## Artifact flow

Each stage reads named input artifacts and writes one output artifact. Milo checks both
skip conditions (output exists) and prereq conditions (inputs exist) before running.

### Join pipeline

```
enrich:  reads  GMB API + site.sourceUrl (HTTP fetch)
         writes artifact "enrich"

clone:   reads  site.sourceUrl
         writes artifacts "mirror-crawl", "mirror-assets", "mirror-snapshot", "mirror-deploy"
         (side effect: cloned site goes live on S3+CloudFront)

docgen:  reads  artifact "enrich" + artifact "mirror-crawl"
         writes 9 docs to DB + artifact "docgen"

content: reads  artifact "mirror-crawl" (all pages, or scoped page when run via milo page)
         writes artifact "content" (page briefs map: path → PageBrief)
```

### Upgrade / rebuild pipeline

```
generate: reads  all docs from DB + artifact "content"
          writes artifact "generate" (GymSiteContent / gym.json)

template: reads  artifact "generate"
          writes Astro build to S3 staging

publish:  reads  staging deploy
          writes production deploy + 301 redirect map (on first upgrade from Tier 1)
          (side effect: template goes live, clone demoted to rollback)
```

### Skip and fail-fast rules

**Skip:** Before running a stage, check whether its output artifact already exists.
If yes, log "skipped — artifact exists" and continue. `--force` disables skip checks.

**Fail-fast:** `milo upgrade` and `milo rebuild` check for `docgen` and `content` artifacts
before running any stages. Missing prereqs produce an actionable error immediately, not a
cryptic mid-pipeline failure.

**`milo page` merge:** The `content` stage, when scoped to a single path, reads the existing
`content` artifact, generates a new brief for the target page, merges it in, and writes the
updated artifact back. Other pages' briefs are preserved.

---

## What changes in the codebase

### Only `milo.ts` changes significantly

The individual stage files (`enrich.ts`, `clone.ts`, `docgen.ts`, `content.ts`,
`generate.ts`, `template.ts`, `publish.ts`) are **unchanged**. No stage logic changes,
no artifact schemas change, no DB changes.

Changes to `milo.ts`:

1. **`parseArgs()`** — add subcommand parsing (`join`, `upgrade`, `rebuild`, `page`, `eval`,
   `nav`, `restore`). The existing `--stages` flag remains as a fallback.

2. **Named pipeline maps** — define the stage lists for each command:
   ```ts
   const PIPELINES = {
     join:    ["enrich", "clone", "docgen", "content"],
     upgrade: ["generate", "template", "publish"],
     rebuild: ["generate", "template", "publish"],
   };
   ```

3. **Prereq checks** — `upgrade` and `rebuild` check for `docgen` + `content` artifacts
   before dispatching to the stage runner. Clear error if missing.

4. **`milo page` handler** — scoped content run. Passes a `pages` filter to the `content`
   stage, then optionally dispatches rebuild for Tier 2 sites. Requires a small addition to
   `content.ts`: accept a `pages?: string[]` option on `StageContext` (or via CLI arg) to
   filter which pages are processed. Currently `content.ts` iterates all pages.

5. **Tool subcommands** — `eval`, `nav`, `restore` dispatch directly to their stage runners
   without the pipeline wrapper (no skip logic, no artifact prereq checks).

### Files not touched

- All `stages/*.ts` files — no changes
- `src/utils/pipeline/artifact-store.ts` — no changes
- `src/types/pipeline-artifacts.ts` — no changes  
- All DB migrations — no changes
- All renderer files — no changes

---

## Testing

End-to-end validation against a real gym URL:

1. `milo join --url <gym-url>` — verify all 4 artifacts exist, cloned site loads
2. `milo upgrade --site <uuid>` — verify `generate` artifact, Astro build loads
3. `milo upgrade --site <uuid>` (no `--force`) — verify all stages skip (idempotent)
4. `milo rebuild --site <uuid> --force` — verify full rebuild runs clean
5. `milo page --site <uuid> --path /about` — verify content artifact updated for `/about` only
6. `milo upgrade` on a site with no join artifacts — verify clear error message
7. `milo eval`, `milo nav`, `milo restore` — verify tool commands run independently

Unit tests: `milo.ts` argument parsing (subcommand routing, stage list resolution,
prereq check logic) — pure functions, no DB needed.
