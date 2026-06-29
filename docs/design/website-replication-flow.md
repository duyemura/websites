# Website Replication Flow

This doc describes the complete end-to-end flow for replicating an existing gym/studio website using the scraper, workspace docs, blueprint, Astro generator, QA loop, and publish gate.

## 1. Start with a URL

A workspace member enters a target URL, for example:

```
https://speakeasyofstrength.com/
```

The system creates an `ai_job` of type `replicate_url` and enqueues it.

## 2. Crawl and scrape the homepage

Playwright loads the homepage and records:

- The site tree: every page reachable from nav, footer, and primary content links.
- Computed style samples across representative elements: colors, fonts, sizes, weights, spacing, radii, borders, shadows, grid/flex behavior.
- Distinctive layout signals: split hero, vertical text, step sections, card grids, carousels, testimonial blocks, pricing tables, trainer grids, schedule embeds.
- Raw text grouped by section: headings, paragraphs, buttons, CTAs.
- Business facts: name, tagline, description, address, phone, email, hours, social links.
- Assets: logo, favicon, images, background images, SVGs, custom fonts.

Output: a `ScrapedWebsiteData` object plus raw asset candidates.

## 3. Generate workspace docs

The scraped data feeds the doc generators. The final doc set is:

| Doc | What it holds |
|-----|---------------|
| `workspace-memory` | Business snapshot, current goal, locked decisions, blockers, backlog, reference doc links. |
| `site-memory` | Site purpose, source URL, replication status, QA issues, publish state, known placeholders. |
| `brand-guidelines` | Colors, typography, spacing, radii, borders, shadows, imagery strategy, layout rules, **voice and copy examples**. |
| `business-info` | Name, tagline, description, contact info, social links, **offerings**, **locations**. |
| `site-structure` | Pages, navigation, footer links. |
| `team-bios` | Coaches/staff (optional). |
| `testimonials` | Member quotes (optional). |
| `faqs` | Questions and answers (optional). |

No separate `offerings`, `locations`, or `voice-copy` docs exist. Their content lives inside `business-info` and `brand-guidelines` respectively to avoid duplication and keep context compact.

## 4. Assemble context for the specific job

`assembleMasterContext(docs, { job: "website-generation" })` layers only the docs needed for that job:

1. `workspace-memory`
2. `site-memory`
3. Current goal (if any)
4. `brand-guidelines`
5. `business-info`
6. `site-structure`
7. `team-bios`
8. `testimonials`
9. `faqs`

Other jobs use smaller subsets:

- `seo-report` uses workspace-memory, site-memory, business-info, site-structure.
- `form-activity-report` uses workspace-memory, site-memory, business-info.

If a requested doc is missing, the assembler logs a warning instead of silently omitting it.

## 5. Emit a single site blueprint

The LLM writes one JSON blueprint for the entire website. Each page is a nested object in the `pages` array.

```json
{
  "site_metadata": {
    "framework": "astro",
    "mode": "replication",
    "target_url": "https://speakeasyofstrength.com/",
    "pages": ["index"]
  },
  "design_tokens": {
    "colors": { "brand_primary": "#B5DF0D", "brand_secondary": "#730A8D", ... },
    "fonts": { "heading": "Bebas Neue", "body": "Nourd Light Font", ... },
    "spacing": { "max_width": "1280px", "section_padding": "96px" },
    "radius": "4px",
    "border_width": "8px"
  },
  "global_shell": {
    "header": { "component_type": "Header", "nav_links": [...], "cta": {...} },
    "footer": { "component_type": "Footer", "social_links": [...] }
  },
  "global_assets": {
    "favicon": "asset_uuid",
    "og_image": "asset_uuid"
  },
  "pages": [
    {
      "slug": "index",
      "is_home": true,
      "meta": { "title": "...", "description": "..." },
      "sections": [
        {
          "id": "hero",
          "component_type": "HeroSection",
          "component_variant": "split_with_vertical_label",
          "order": 0,
          "content": { "headline": "...", "subheadline": "...", "cta_label": "..." },
          "assets": { "background_image": { "strategy": "scrape_download", ... } },
          "styles": { "text_alignment": "left", "padding": "py-24" }
        }
      ]
    }
  ]
}
```

Validation:

- Zod schema validation.
- Every asset has a strategy: `workspace_asset`, `scrape_download`, or `generate`.
- Every page has a slug, meta, and ordered sections.

## 6. Resolve assets

The asset engine processes every asset reference in the blueprint:

| Type | Resolution |
|------|------------|
| Logo, favicon, original photos | `scrape_download` into the workspace asset library. |
| Missing or low-quality images | `generate` from brand + context. |
| Fonts | Map scraped names to Google Fonts or closest fallback. |
| OG image | `generate` 1200x630. |
| Icons | Use Lucide / Heroicons subset. |

Assets are stored in S3 with workspace-scoped keys. The blueprint is updated with final asset URLs.

## 7. Generate Astro source code

The generator creates an ephemeral working directory and scaffolds:

- `src/layouts/Layout.astro` — global wrapper, fonts, meta, CSS variables from tokens.
- `src/components/shared/Header.astro`, `Footer.astro`, `Nav.astro`, etc.
- `src/components/sections/*.astro` — one component per section, synthesized from the blueprint variant.
- `src/pages/[slug].astro` — one file per blueprint page.

Because we use Model B, each generated site owns its full component tree. The generator may create custom components like `HeroSplitWithVerticalLabel.astro` based on the `component_variant` detected during scraping. System components are only starting references.

The generated Astro source is persisted at `sites/{siteUuid}/source/{attemptId}/`. It is not thrown away after build.

## 8. Build and automated QA

The generator runs `astro build`. QA then checks:

- Build health: `astro build` exits 0, `/dist` exists, no 404 assets.
- Links: all internal links resolve.
- Console: no runtime errors.
- Responsive: screenshots at 1440px, 768px, and 375px; no horizontal scroll or clipped content.
- Visual diff against reference screenshots (replication mode).
- Content: no placeholder text, SEO meta present, alt text present.
- Asset integrity: no broken images, correct aspect ratios.

Issues are classified by component, category, severity, and suggested doc update. Auto-fixable issues loop back into code generation up to `max_qa_iterations`.

## 9. Show incremental progress to the user (future UX)

Before the final review gate, the user sees a read-only stream of the generation process:

- Current phase: scrape → blueprint → assets → code → build → QA → review.
- LLM reasoning summaries per phase.
- QA issues found and the fixes applied.
- Screenshots after each build attempt.
- Cost and token usage so far.
- Final preview URL once QA passes or max iterations are reached.

This log is persisted to `ai_activity` and `site-memory`.

## 10. Human review and publish

After QA passes or maxes out:

1. Build artifact stored at `sites/{siteUuid}/dist/{attemptId}/`.
2. Deployment record set to `ready_for_review`.
3. Preview URL served to workspace members.
4. User approves, requests changes, or rejects.
5. On approval, promote to published and update DNS / CDN.

For homepage replication, this approval locks the blueprint baseline before the remaining pages are generated.

## 11. Continuous improvement

Every run is logged to `ai_activity` with model, tokens, cost, latency, outcome, and corrections.

When a replication fails:

- The issue is classified.
- The system proposes a doc update (e.g. adjust `brand-guidelines` color rules, add `business-info` detail, record a locked decision in `workspace-memory`).
- During build/self-healing, doc updates are auto-applied.
- When a user changes site-wide styles via the AI Assistant, the change is confirmed, written to the doc, and logged.

The code stays generic. Improvements come from docs.

## Anti-patterns

- Do not create separate `offerings`, `locations`, or `voice-copy` docs. Their content belongs in `business-info` and `brand-guidelines`.
- Do not assemble the same context for every job; use `job` presets.
- Do not throw away the generated Astro source after build.
- Do not hide the incremental QA/build log from the user.
- Do not add per-site `if (site === "x")` code in the generator.
