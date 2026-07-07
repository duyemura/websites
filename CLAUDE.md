# Milo workspace notes

This file is for workspace-specific Claude Code guidance that does not belong in a single app.

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
