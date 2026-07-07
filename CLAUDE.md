# Milo workspace notes

This file is for workspace-specific Claude Code guidance that does not belong in a single app.

## Product model

Milo (internal name) is a gym website platform with two tiers. **A site is always one or the
other — never both simultaneously.**

### Tier 1 — Hosted (free)
Gym joins → we clone their existing site via Playwright, capture every asset, rehost on
S3 + CloudFront. Gym cancels their old host (Webflow, Squarespace, etc). They get free hosting
and light ability to manually edit. The clone is the product.

### Tier 2 — Managed (paid)
Gym upgrades to an Astro template. This unlocks:
- Structured content editing (pages, sections, copy)
- AI-assisted website management: keyword monitoring, pillar pages, local SEO content, blog
- GSC integration → content loop (Phase 2)

The mirror clone stays as a rollback artifact but is not live once the template is promoted.

**Future:** Show the gym the delta between their current site and what the template would
produce — so they can preview the upgrade before committing.

## Pipeline shape

The `milo` CLI (`apps/api/scripts/milo.ts`) orchestrates stages. Run with:
`pnpm milo --url <url> [--stages s1,s2,...] [--theme baseline|impact|beanburito]`

### Main pipeline (Tier 2 — full managed site)
```
enrich   → GMB lookup → authoritative name, address, hours, phone
clone    → Playwright BFS crawl + all assets + rewrite URLs + S3 deploy (also serves Tier 1)
docgen   → enrich artifact + mirror-crawl HTML → 9 structured docs written to DB
generate → all docs → LLM → complete GymSiteContent (gym.json)
template → gym.json → Astro render → S3 staging deploy
publish  → staging → production
```

Default stages for a new URL: `enrich,clone,docgen,content` (content is under review for removal).

### Auxiliary tools (not main pipeline stages)
- `eval` — pixel-diff between source site and mirror, for QA
- `nav-rebuild` — patch nav in an existing generated site without re-running LLM
- `restore` — roll back to a prior site version
- `template-eval` — smoke-test the rendered template

### Vision track (experimental, parallel)
`extract → segment → contract` — Playwright visual capture + section detection + visual
contracts. Future replacement for the docgen content extraction path. Not in main pipeline yet.

## Image generation API hardening todos

The AI image generation backend in `apps/api` is functional but has a list of remaining API-side hardening items. The detailed list (11 items) lives in `.claude/docs/asset-generation-todos.md`. Integration tests for the route and service layer have been added; everything else on that list is still open.

## Image generation API hardening todos

The AI image generation backend in `apps/api` is functional but has a list of remaining API-side hardening items. The detailed list (11 items) lives in `.claude/docs/asset-generation-todos.md`. Integration tests for the route and service layer have been added; everything else on that list is still open.
