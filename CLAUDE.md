# Milo workspace notes

This file is for workspace-specific Claude Code guidance that does not belong in a single app.

> ## ⚠️ AUTONOMY RULE — READ FIRST
> For **every** task in this repo, Claude Code must work autonomously and keep approval surface minimal:
> - **Batch** shell/AWS/rtk/read/edit operations into the fewest tool calls possible. Never dribble one command per turn.
> - **Run long or multi-step work as background tasks** (Bash `run_in_background`, Agent tool) and report back with a concise summary.
> - **Use the Agent tool** for any task that needs more than 3 sequential operations or touches multiple files — the agent does the work and returns the conclusion.
> - Only stop to ask the user for: destructive actions, production pushes, real money spend, or genuinely ambiguous requirements.
> The goal is minutes of work, not days of back-and-forth.

## Product model

Milo is a gym website platform with two tiers. **A site is always one or the other — never both simultaneously.** Never use the word "mirror" — it's always "clone."

### What happens at join time (everyone, free)

When a gym joins, we run the full intelligence-gathering pipeline:

```
enrich  → GMB lookup → authoritative name, address, hours, phone, category
clone   → Playwright BFS crawl + all assets captured + rehosted on S3+CloudFront
docgen  → crawl HTML + GMB facts → 9 structured docs written to DB
```

The gym cancels their old host (Webflow, Squarespace, etc). Their cloned site goes live.
They get free hosting and light ability to manually edit. **The docs are gathered upfront for
everyone** — this is what makes the upgrade path instant and the AI features possible later.

### Tier 1 — Hosted (free)
The cloned site is live. Gym can make light edits. Docs exist in DB for future use.

### Tier 2 — Managed (paid)
Gym upgrades → we use the already-gathered docs to generate an Astro template site:

```
generate → existing docs → LLM → complete GymSiteContent (gym.json)
template → gym.json → Astro render → S3 staging
publish  → swap: clone goes to rollback, template goes live (with 301 redirect map)
```

Unlocks: structured editing, AI content loop (keyword monitoring, pillar pages, local SEO,
blog automation), GSC integration.

**No re-clone needed on upgrade** — docs were gathered at join time.

### Future — Delta preview
Before a gym commits to upgrading, show them side-by-side: their current cloned site vs what
the template would generate. Run `generate + template` against existing docs as a preview-only
deploy. No re-clone, no extra LLM cost beyond what generate already does.

### Hard rules — never violate
- **Clone runs once.** After join, Milo is the system of record. Never re-clone, never re-sync from source.
- **All changes go through Milo** — manual doc edits, AI assistant, or editor UI. The source site is irrelevant after join.
- **`site-hierarchy` doc covers page structure** — Tier 2 can add/remove/reorder pages by editing this doc and rebuilding.
- **Docs are the single source of truth.** Generate reads docs → produces gym.json → template renders it. Any doc change → rebuild → live site reflects it.
- **Edit path for Tier 1 (clone):** AI edits docs → HTML transforms applied to static clone (works for content: copy, hours, nav, SEO). Cannot add pages (clone is static).
- **Edit path for Tier 2 (template):** AI edits docs → `generate → template → publish`. Full structural changes possible including new pages via site-hierarchy.

## Pipeline stages

The `milo` CLI (`apps/api/scripts/milo.ts`) orchestrates stages. Run with:
`pnpm milo --url <url> [--stages s1,s2,...] [--theme baseline|impact|beanburito]`

### Join pipeline (runs for every gym at signup)
`enrich → clone → docgen`

### Upgrade pipeline (runs when gym upgrades to Tier 2)
`generate → template → publish`

### Full pipeline (dev/testing — runs both in sequence)
`enrich → clone → docgen → generate → template → publish`

### Auxiliary tools (separate CLI commands, not pipeline stages)
- `eval` — pixel-diff QA between source site and clone
- `nav-rebuild` — patch nav in an existing generated site without re-running LLM
- `restore` — roll back to a prior site version
- `template-eval` — smoke-test the rendered template

### Vision track (experimental)
`extract → segment → contract` — richer Playwright visual capture + section detection.
Future replacement for docgen's content extraction. Not in main pipeline yet.

### The `content` stage
Currently sits between `docgen` and `generate`. Does per-page LLM extraction (hero copy,
testimonials, FAQ per page). Under review — may be absorbed into `generate` or moved into
the join pipeline as part of `docgen`. Decision pending simplification design.

## Image generation API hardening todos

The AI image generation backend in `apps/api` is functional but has a list of remaining
API-side hardening items. The detailed list (11 items) lives in
`.claude/docs/asset-generation-todos.md`. Integration tests added; everything else open.
