# Evals and Self-Healing System

## Goal

Build an automated evaluation harness that can run many site generation attempts against real URLs, measure quality and cost, and use the results to improve prompts and docs — never per-site generation code.

This is how the system gets better over time without accumulating site-specific hacks.

## Core principle

**Code is generic. Improvement comes from docs.**

- The generator code does not change for one site.
- If a URL fails to replicate well, the system updates a doc (brand-guidelines format, copy examples, component notes, workspace memory, or a shared `lessons` doc) and re-runs.
- The only time generation code changes is through deliberate engineering work on the component registry, schemas, or orchestrator.

## Eval pipeline

```
[Input URL or brief]
   │
   ▼
[Run generation N times] ──► capture blueprint, code, /dist, screenshots, cost
   │
   ▼
[Automated evals]
   ├─ Pixel/structural diff against reference
   ├─ Copy quality checks (placeholders, duplicates, length)
   ├─ Asset checks (missing, low-res, wrong aspect ratio)
   ├─ Build health (astro build passes, no 404s, no console errors)
   ├─ Responsive checks (desktop, tablet, mobile)
   └─ Semantic checks (nav links, business name, CTAs)
   │
   ▼
[Score + issue classification]
   │
   ├─ good enough ──► record as passing example
   └─ problems ──► update docs/prompts, re-run
```

## Eval dimensions

| Eval | What it checks | Tool |
|------|---------------|------|
| `visual_diff` | Screenshot similarity to reference | Pixel diff + vision model summary |
| `layout_structure` | Element order, grid columns, section presence | DOM/Playwright + schema checks |
| `typography` | Font family, size hierarchy, weights | Computed style extraction |
| `color_fidelity` | Brand colors present and applied | Color histogram + token checks |
| `asset_integrity` | No broken images, correct aspect ratios, no placeholders | Playwright + image analysis |
| `copy_quality` | No placeholder text, no duplicates, on-brand voice | LLM + regex |
| `link_health` | Internal links resolve | Link crawler |
| `responsive` | No horizontal scroll, readable at 1440/768/375 | Playwright screenshots |
| `build_health` | `astro build` exits 0, `/dist` is valid | CLI + file checks |

## Issue classification

Every failing eval emits an issue with:

```json
{
  "eval": "visual_diff",
  "category": "typography",
  "component_id": "hero",
  "description": "Hero heading is too small on mobile",
  "severity": "high",
  "suggested_doc_updates": [
    {
      "doc_key": "brand-guidelines",
      "update": "Add rule: hero heading must be text-5xl on mobile for this brand."
    }
  ]
}
```

## Self-healing via docs

The system uses issues to propose doc updates. A human or an LLM reviewer applies the updates.

Examples:

- Color wrong? Update `brand-guidelines` color rules or add a pairing rule.
- Copy too generic? Update `brand-guidelines` voice and copy examples with better samples.
- Component layout off? Update `workspace-memory` with a locked decision about that component variant.
- Fonts not matching? Update `brand-guidelines` typography section with explicit fallback rules.

A shared `lessons-learned` doc can also capture cross-site fixes that should apply to all future generations.

## Cost tracking

Every eval run records cost per phase:

| Phase | Logged to `ai_activity` |
|-------|-------------------------|
| `blueprint` | LLM calls that produce the blueprint |
| `copy` | LLM calls that write headlines/body/SEO |
| `assets` | Image generation or download |
| `code` | LLM calls that generate Astro code |
| `build` | Not an LLM cost, but logged as a step |
| `qa` | LLM/vision calls, screenshot capture |

Each row records model, tokens, cost, latency, outcome, and a summary.

## Workspace credits

- Each workspace has a monthly credit pool.
- Credits are consumed by generation/eval jobs.
- Credits refresh monthly when the workspace's SaaS subscription renews.
- Out of credits = jobs pause until the workspace re-ups.
- Credit tracking is separate from `ai_activity` but reconciled from it.

## Running 1000 tests

The harness accepts:

- A list of target URLs or briefs.
- A number of attempts per input.
- A max spend cap.
- A set of evals to run.

After running, it produces:

- A report: per-input scores, issues, cost.
- Aggregate stats: pass rate, average cost, common issue categories.
- Recommended doc updates ranked by expected impact.
- A diff of what changed in docs between runs.

## Anti-patterns

- Do not add per-site `if (site === "x")` code.
- Do not let the eval harness silently drop failing runs.
- Do not use eval scores as a single number; report issue categories.
- Do not generate new component code per site inside the eval loop.

## Open questions

1. Do evals run automatically after every generation, or only in explicit eval batches?
2. **Self-healing approval.** ✅ **Decision: during build and self-healing processes, doc updates are auto-applied without human approval. When a user changes site-wide styles through the AI Assistant, confirm the change and write it to the relevant doc, logging the activity.**
3. How do we prevent the `lessons-learned` doc from growing too large and polluting context?
4. Should we keep a separate "eval workspace" for testing so production docs don't get polluted?
5. How do we measure "copy quality" without a reference URL?
