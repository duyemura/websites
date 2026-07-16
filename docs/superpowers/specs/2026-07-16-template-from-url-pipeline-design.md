# Template-from-URL Pipeline — Design Spec

**Date:** 2026-07-16  
**Status:** Approved for implementation  

---

## Problem

Milo has one production template (`beanburito`) and two stubs (`impact`, `baseline`). Adding a new template today requires hand-writing a 50K+ TemplateSpec, building Astro components from scratch, and authoring LLM context docs manually. There is no systematic process for creating a template from a reference site.

This spec defines a pipeline that takes a URL and produces a production-ready Astro template at 98% visual fidelity, with an agentic self-healing loop to close the gap.

---

## Scope

- **Operator:** developer-operated (not fully automated end-to-end)
- **Input:** any URL — a real gym site whose design is being replicated, or a prototype/mockup site
- **Fidelity target:** 98% visual match (static appearance; dynamic hover/scroll effects excluded)
- **Output:** committed Astro components + TemplateSpec + production LLM context docs

Not in scope: UI-based template selection, automated deployment of new templates, dynamic/animated effects matching.

---

## Pipeline

```
extract → segment → contract → synthesize → component-eval
```

The first three stages already exist as the "vision track." This spec adds two new stages: `synthesize` and `component-eval`.

**CLI entry point:**
```bash
milo template --url <url> --name <templatename>
```

Runs all five stages in sequence. The `--name` flag sets the template identifier used in all output paths. The `--url` flag is the reference site; the site record is created as a scratch workspace (not a hosted gym site).

---

## Stage: `synthesize`

**Inputs:**
- Contract artifact — per-section computed CSS values, layout archetype classification, section crops on S3 at 1440 and 375px
- Extract artifact — full-page CSS (font-face declarations, custom properties), site map

**What it does:**

### 1. Group sections into components

Groups all detected sections across all pages by `(tag, archetype)` pair — e.g. `(hero, hero-left)`, `(cta-band, cta-band)`, `(feature-grid, feature-grid-bento)`. Each unique pair becomes one Astro component. For pairs that appear on multiple pages, picks the exemplar with the clearest crop (largest bounding box, fewest obstructions).

Shared components identified by the segment stage's cross-page fingerprinting (header, footer, nav) each get one component regardless of page count.

### 2. Generate Astro components

For each component, sends to the vision LLM:
- Desktop (1440px) and mobile (375px) section crops as images
- The full `SectionContract` — exact computed spacing, typography (size, weight, color, transform), background (color, image, gradient), interaction flags (accordion, scroll-snap, hover)
- The site's extracted CSS for font-face and custom property declarations
- Instruction: generate a complete `.astro` file that replicates this section exactly, using scoped CSS with the extracted values, a typed props interface, and named content slots inferred from what is visible

Output per component:
- `[ComponentName].astro` — complete Astro component with HTML structure, scoped CSS, typed props
- Component name is PascalCase derived from `(tag + archetype)`: `hero-left` → `HeroLeft`, `cta-band` → `CtaBand`

Also generates a `[templatename].css` design token file with primary color, accent, heading font, body font, and spacing scale extracted from the contract.

**Output path:**
```
apps/renderer/src/components/sections/[templatename]/Header.astro
apps/renderer/src/components/sections/[templatename]/Footer.astro
apps/renderer/src/components/sections/[templatename]/HeroLeft.astro
apps/renderer/src/components/sections/[templatename]/CtaBand.astro
...
apps/renderer/public/styles/[templatename].css
```

### 3. Generate TemplateSpec

After all components are written, synthesizes the TypeScript TemplateSpec by:
- Mapping each `(tag, archetype)` → `ComponentSpec` with the generated component name and prop schema
- Reading the extract artifact's site map to infer page archetypes (home, about, contact, pricing, etc.) and their detected section sequences
- Extracting design tokens (colors, fonts) into `templateTokens`

Writes the spec to `packages/shared-types/src/templates/[templatename].ts` and auto-updates `registry.ts` to register it.

**Output path:**
```
packages/shared-types/src/templates/[templatename].ts
packages/shared-types/src/templates/registry.ts   (updated)
```

### 4. Generate LLM context docs

Three markdown files written to production prompt paths (not `.claude/` — these are read by the site builder at runtime):

- `personality.md` — design language, visual tone, what makes this template distinctive; used by the `generate` stage to write on-brand copy
- `components.md` — per-component: what it renders, what each prop slot expects, content rules and constraints
- `page-archetypes.md` — which pages exist, what archetype each maps to, the component sequence per page, content priorities per page

Also generates a companion TypeScript loader following the existing `scraped-asset-vision.ts` pattern.

**Output path:**
```
apps/api/src/ai/prompts/site-templates/[templatename]/personality.md
apps/api/src/ai/prompts/site-templates/[templatename]/components.md
apps/api/src/ai/prompts/site-templates/[templatename]/page-archetypes.md
apps/api/src/ai/prompts/site-templates/[templatename].ts
```

---

## Stage: `component-eval`

**Goal:** Close the gap between generated components and the source design to 98% fidelity using an agentic self-healing loop. Human reviews the finished result, not the intermediate fixes.

**Stub content:** The stage generates a `[templatename].fixture.json` alongside the components — a `GymSiteContent` object with every slot filled with realistic placeholder text and image URLs sourced from the original section crops. This fixture is used exclusively for eval builds; it is not the gym's real content.

**For each component:**

1. **Build** — renders the full template using the fixture JSON, via the existing Astro build pipeline
2. **Crop** — re-runs segment stage section detection against the rendered output to crop each component at 1440 and 375px
3. **Pixel diff** (pass 1) — compares rendered crop to original source crop; scores 0–100. Components ≥ 85 pass and exit the loop.
4. **Vision diff** (pass 2, for components below 85) — vision model compares the two crops and returns a specific issues list: not "they differ" but "heading font-weight is 400, expected 700" / "background-color is #1a1a1a, expected #0a0a0a" / "CTA button padding-bottom is 8px, expected 16px"
5. **Agentic fix** — AI agent receives: current component code + original section crop + rendered section crop + issues list. Agent makes targeted CSS/HTML edits to the `.astro` file.
6. **Re-eval** — rebuild → re-crop → re-diff → new score
7. **Loop** — repeats up to 5 iterations per component. If a component hasn't cleared 85 after 5 passes, it is flagged in the final report for human review.

**Fidelity target:** 98% of components clear the 85-point threshold within the loop. The remaining gap (~2%) is environmental rendering noise (font hinting, subpixel anti-aliasing) that cannot be closed programmatically.

**Final report:**

Written to `docs/template-review/[templatename]-gaps.md`. Lists any components that hit max iterations, their final score, and the specific remaining issues. Human reviews this file and makes targeted edits only to the flagged components — not the full template.

**Targeted re-eval:**
```bash
milo template-eval --name [templatename] --component HeroLeft
```
Re-runs just one component's diff after a manual fix.

---

## Output file summary

| Path | What |
|------|------|
| `apps/renderer/src/components/sections/[name]/*.astro` | Astro components |
| `apps/renderer/public/styles/[name].css` | Design token CSS |
| `packages/shared-types/src/templates/[name].ts` | TemplateSpec |
| `packages/shared-types/src/templates/registry.ts` | Updated registry |
| `apps/api/src/ai/prompts/site-templates/[name]/*.md` | LLM context docs |
| `apps/api/src/ai/prompts/site-templates/[name].ts` | Doc loader |
| `apps/renderer/src/content/[name].fixture.json` | Stub content for eval builds |
| `docs/template-review/[name]-gaps.md` | Human review report |

---

## What does not change

- `extract`, `segment`, `contract` stages — unchanged, reused as-is
- The `generate` and `template` stages for gym site building — unchanged
- The existing beanburito, impact, baseline templates — unchanged
- The clone pipeline — not involved; template creation is a separate pipeline

---

## Developer handoff

The `synthesize` stage automatically updates `TemplateTheme` in `packages/shared-types/src/templates/types.ts` and the `--theme` CLI flag in `apps/api/scripts/milo-args.ts`. No manual type changes required.

After `component-eval` completes:
1. Review `docs/template-review/[templatename]-gaps.md`
2. Fix only the flagged components (typically none; rarely 1–2)
3. Run `milo template-eval --name [templatename] --component [Name]` to verify each fix
4. Test end-to-end: `milo new --url <real-gym-url> --theme [templatename]`
5. Commit everything
