# Website Generation System

## Goal

Build an API-invokable system that can generate or replicate static websites compiled with Astro. The output is a deployable static bundle (`/dist`).

- **Greenfield:** on-brand, content-complete, responsive, and functional.
- **Replication:** visually faithful to the source site within an acceptable tolerance, with a human review gate for the final 10%.

This is the foundational capability of the product. The editor, playbooks, AI chat, and PushPress integrations all feed into or consume this pipeline.

## Success criteria

| Mode | Success definition |
|------|---------------------|
| Greenfield | The generated site matches the brand guidelines, includes requested pages/sections, uses real business data where available, has no broken links or console errors, and looks professional on desktop and mobile. |
| Replication | The generated site is visually faithful to the source: layout, color palette, typography, imagery, and navigation are recognizable and correct. A human review step catches remaining differences before publish. |

We do **not** target literal 100% pixel-perfect automation. That is expensive, fragile, and rarely necessary. The system targets "good enough to preview" automatically and "good enough to publish" after review.

## Operating principles

- **Blueprint first.** No code is written until the AI emits a validated JSON blueprint. The blueprint is the single source of truth for pages, sections, design tokens, assets, and shared shell.
- **Source of truth is the build artifact.** A generation step is not done until `astro build` succeeds and produces a valid `/dist`.
- **No hallucinated dependencies.** Components use standard Astro patterns, Tailwind CSS, and workspace assets. External UI libraries are not installed unless explicitly configured.
- **Human-in-the-loop for publish.** Automated QA catches obvious problems. Human review is required before a site goes live.
- **Reproducible from blueprint.** The generated Astro project is a function of the blueprint and the component registry. Editing the blueprint and re-running the generator reproduces the site.

## High-level pipeline

```
[Ingestion]
   │
   ├── Greenfield: brief + workspace docs + PushPress data
   └── Replication: URL crawler + scraper + screenshots
   │
   ▼
[Blueprinting]
   │
   ▼
[Asset Engine] ── images, fonts, icons, logos, favicons
   │
   ▼
[Code Generation] ── Astro + Tailwind from blueprint
   │
   ▼
[Automated QA]
   │
   ├─ pass ──► [Static Build]
   └─ fail ──► [Code Generation] (loop until max iterations or human override)
```

## 1. Ingestion

### Greenfield inputs

- User brief (text prompt): business, audience, desired pages, tone, must-have sections.
- Workspace docs: `workspace-memory`, `brand-guidelines`, `business-info`, `offerings`, `locations`, `team-bios`, `testimonials`, `voice-copy`.
- PushPress data (via adapter): locations, classes, plans, coaches, real testimonials, pricing.
- User-selected assets: logo, hero images, staff photos.

Output: a **structured brief** JSON with niche, audience, pages, sections, tone, required data sources, and constraints.

### Replication inputs

- Target URL.

Steps:

1. **Site tree discovery.** Crawl the target origin and record every page reachable from the main nav, footer, and primary content links. Deduplicate by canonical URL; ignore external links, query-string variants, and file downloads.
2. **Homepage first.** Capture the homepage, extract design tokens, DOM structure, typography, images, fonts, icons, and the global shell. Produce `brand-guidelines`, `business-info`, `site-structure`, `voice-copy`, `offerings`, `locations`.
3. **Approval gate.** Generate and QA the homepage. Present the preview URL. The user approves the homepage before we build the rest of the site.
4. **Remaining pages.** After homepage approval, use the approved blueprint's design tokens, global shell, and QA notes to generate the other pages from the recorded site tree.

## 2. Blueprinting

The blueprint is a validated JSON document. It is the contract between ingestion, assets, code generation, QA, and the editor.

```json
{
  "site_metadata": {
    "framework": "astro",
    "mode": "replication",
    "target_url": "https://example.com/",
    "pages": ["index", "about", "programs", "locations"]
  },
  "design_tokens": {
    "colors": {
      "brand_primary": "#B5DF0D",
      "brand_secondary": "#730A8D",
      "background": "#FFFFFF",
      "text": "#0F0F0F",
      "muted": "#3F444B"
    },
    "fonts": {
      "heading": "Bebas Neue",
      "body": "Nourd Light Font",
      "accent": "Rock Salt",
      "fallback": "sans-serif"
    },
    "spacing": {
      "max_width": "1280px",
      "section_padding": "96px"
    },
    "radius": "4px",
    "border_width": "8px"
  },
  "global_shell": {
    "header": {
      "component_type": "Header",
      "logo_asset": "asset_uuid_or_url",
      "nav_links": [
        { "label": "Programs", "href": "/programs" }
      ],
      "cta": { "label": "Join now", "href": "/join" }
    },
    "footer": {
      "component_type": "Footer",
      "social_links": [],
      "locations": []
    }
  },
  "global_assets": {
    "favicon": "asset_uuid",
    "og_image": "asset_uuid"
  },
  "pages": [
    {
      "slug": "index",
      "is_home": true,
      "meta": {
        "title": "Speakeasy of Strength",
        "description": "..."
      },
      "sections": [
        {
          "id": "hero",
          "component_type": "HeroSection",
          "order": 0,
          "content": {
            "headline": "Awesome for Everyone. Shame Free. Mighty Strong.",
            "subheadline": "...",
            "cta_label": "Explore Our Locations",
            "cta_href": "/locations"
          },
          "assets": {
            "background_image": {
              "placeholder_id": "hero_bg",
              "context": "athletes training in a gritty brooklyn gym, high contrast lighting",
              "dimensions": [1440, 900],
              "strategy": "generate"
            }
          },
          "styles": {
            "text_alignment": "left",
            "vertical_alignment": "center",
            "padding": "py-24",
            "overlay": "rgba(0,0,0,0.4)"
          }
        }
      ]
    }
  ]
}
```

### Validation

- JSON schema validated by Zod.
- Every `component_type` exists in the component registry.
- Every asset has a `strategy`: `workspace_asset`, `scrape_download`, or `generate`.
- Every page has a valid slug, meta, and ordered sections.

## 3. Copy engine

A dedicated copy engine produces page content from inputs:

- **Brand voice + business info** set the tone.
- **PushPress data** provides real facts: class names, coach names, location addresses, pricing.
- **Section type templates** provide structure (hero, features, pricing, testimonials).
- **User brief** provides constraints and page list.

Output: section-level content JSON (headlines, body copy, CTAs, alt text, SEO titles/descriptions) that feeds into the blueprint.

For replication, the copy engine extracts and reuses existing copy instead of generating it.

## 4. Asset engine

The asset engine resolves every asset reference in the blueprint.

### Asset taxonomy and strategies

| Type | Strategy | Notes |
|------|----------|-------|
| Images (hero, backgrounds, cards) | For replications: `scrape_download` all originals into the asset library. For greenfield: `workspace_asset` if uploaded; `generate` if missing. | Replications assume the client owns their own creative materials. |
| Logos / wordmarks | `scrape_download` for replications; `workspace_asset` for greenfield. | SVG or PNG; preserve transparency. |
| Favicon | `scrape_download` for replications; `workspace_asset` or `generate` for greenfield. | Standard sizes. |
| OG / social image | `generate` from brand + hero context | 1200x630. |
| Fonts | `web_font` (Google Fonts / Adobe Fonts) by name; `system_fallback` if unavailable | Scrape gives font names; map to closest hosted font. |
| Icons | `icon_set` (Lucide, Heroicons, FontAwesome subset); `generate_svg` for custom | Prefer system icon set; avoid per-build icon downloads. |
| SVGs / custom graphics | `scrape_download` for replications; `generate` for greenfield | Preserve as-is when replicating. |

### Asset resolution steps

1. Collect all asset references from `global_shell`, `global_assets`, and each page section.
2. For each reference, choose the best available source.
3. Download or generate assets into workspace-scoped storage.
4. Update the blueprint with final asset URLs/storage keys.

## 5. Code generation

1. Create an ephemeral working directory for the build.
2. Scaffold the Astro project:
   - `src/layouts/Layout.astro` — global wrapper, fonts, meta, CSS variables from design tokens.
   - `src/components/shared/Header.astro`, `Footer.astro`, `Nav.astro`, etc. from `global_shell`.
   - `src/components/sections/*.astro` — one component per registered section type.
   - `src/pages/[slug].astro` — one file per blueprint page.
3. Render sections by mapping `component_type` to the registered Astro component and passing props from the blueprint.
4. Use Tailwind CSS for styling. Design tokens map to Tailwind config + CSS custom properties.
5. Install pinned dependencies (`astro`, `@astrojs/tailwind`, `tailwindcss`, etc.) and run `astro build`.

### Build sandbox details

- Local temp directory for the PoC.
- Dependency versions pinned in a template `package.json` copied into each build.
- Shared system components are copied into `src/components/system/` per build, not installed from npm.
- Build errors are captured and returned in the QA report.
- For production, move to an isolated sandbox (E2B, Firecracker, or Docker) before running user-influenced code.

## 6. Automated QA

QA is issue-based, not score-based.

### Checks

| Category | Checks |
|----------|--------|
| Build | `astro build` exits 0; `/dist` exists; no 404 assets. |
| Links | All internal links resolve; external links have valid URLs. |
| Console | No runtime errors or uncaught exceptions on load. |
| Responsive | Screenshots at 1440px and 375px; no horizontal scroll or clipped content. |
| Visual (replication only) | Diff summary against reference screenshots; flag large layout/color/typography deviations. |
| Content | No placeholder text remains; SEO meta is present; alt text is present. |

### Output

A QA report:

```json
{
  "passed": false,
  "summary": "Hero heading too small on mobile; footer logo missing.",
  "issues": [
    {
      "component_id": "hero",
      "category": "typography",
      "issue": "Hero heading is too small on mobile",
      "severity": "high",
      "suggested_fix": "Change mobile h1 from text-3xl to text-5xl"
    },
    {
      "component_id": "footer",
      "category": "assets",
      "issue": "Footer logo asset is missing",
      "severity": "medium",
      "suggested_fix": "Generate a logo from the brand name or use uploaded logo"
    }
  ]
}
```

### Correction loop

- If issues are auto-fixable (style values, asset regeneration), feed the report back into code generation.
- Loop up to `max_qa_iterations`.
- If issues remain, stop and present the QA report + preview URL to the user for review.

## 7. Human review and publish

After automated QA passes (or after max iterations):

1. Create a deployment artifact from `/dist`.
2. Create a deployment record with status `ready_for_review`.
3. Serve a preview URL scoped to workspace members.
4. User can approve, request changes, or reject.
5. On approval, promote to published and update DNS / CDN.

## 8. Post-generation editing

For the first phase, the **blueprint is read-only output** used by the generator. We are not building an editor yet.

Future phases:
- The blueprint becomes the editable source of truth.
- Re-running the generator reproduces the Astro project from the updated blueprint.
- Asset uploads and copy tweaks flow back into the blueprint.
- The Astro project itself is ephemeral; only the blueprint and the final `/dist` artifact are persisted.

## 9. Component model

**Decision: Model B — each generated site owns its full Astro component tree.**

System components in `apps/renderer/src/components/` exist as starting templates and reusable examples, but every generated site gets its own fork of the components it uses.

- The generator may copy a system component into the site's source directory as a starting point.
- It may then customize that component for the specific site.
- All components in a generated site are owned by that site.
- Improvements to system components do not auto-update existing sites. A future "refresh from template" operation can be built separately.

This model is necessary because real-world sites will not all fit into a fixed set of shared templates.

## 9. Component synthesis from scraped design signals

The scraper and designer do not just dump raw data into the generator. They detect structural patterns from the source site and emit a `component_variant` / `layout_type` per section so the generator can create the right Astro shape.

Example patterns detected from a scrape:

| Detected pattern | Generated component shape |
|------------------|----------------------------|
| Hero with side-by-side image + text | `HeroSplit.astro` with left/right responsive stack |
| Vertical rotated label beside hero | `HeroWithVerticalLabel.astro` |
| Numbered step / timeline section | `StepsTimeline.astro` |
| Testimonial carousel | `TestimonialCarousel.astro` |
| Pricing cards with feature list | `PricingCards.astro` |
| Class schedule embed | `ScheduleEmbed.astro` |
| Trainer grid with bios | `TrainerGrid.astro` |

The blueprint captures these as:

```json
{
  "sections": [
    {
      "id": "hero",
      "component_type": "HeroSection",
      "component_variant": "split_with_vertical_label",
      "order": 0,
      "content": {},
      "styles": {
        "layout": "split",
        "vertical_label": "Strength starts here",
        "text_alignment": "left",
        "padding": "py-24"
      }
    }
  ]
}
```

Rules:

- Variants are descriptive, not from a closed enum. New variants can appear any time the generator invents a matching Astro component.
- The generator creates the component file in the site's source tree; it is not required to exist in the system registry first.
- System components act as reference implementations (markup patterns, Tailwind conventions, accessibility helpers) but are not forced on the site.
- Shared infrastructure components (image lazy loading, SEO, navigation, links) still come from the system and live in `src/components/shared/`.

This makes replication flexible: a bold, non-standard gym layout gets its own generated component instead of being crammed into a prebuilt template.

## 10. Blueprint persistence

- One blueprint per site.
- When the homepage is approved, the blueprint is **locked as a baseline**.
- Remaining pages are generated from the locked baseline.
- Future generation attempts can overwrite the blueprint, but the approved baseline is preserved for rollback.

## 11. Asset provenance and replacement

- Scraped originals are stored directly in the workspace asset library.
- Source URLs are **not** persisted.
- Low-quality or broken images are flagged and replaced by AI-generated assets when possible.
- Until an editor exists, the only way to replace an asset is via the AI Assistant.

## 12. Multi-page job orchestration

- **One job per page.**
- The homepage job is the gate. Remaining page jobs are created after homepage approval.
- Page failures do not block preview/publish of pages that succeeded.
- For phase 1, focus only on the homepage.

## 13. Build output lifecycle

- Temp build directories live indefinitely for now. Cleanup is a future concern.
- Store both the generated Astro source code and the `/dist` artifact.
- Astro source is kept because it is easier to edit later than raw HTML.
- **Storage location:** S3 prefix `sites/{siteUuid}/source/{attemptId}/` for source, and `sites/{siteUuid}/dist/{attemptId}/` for the built artifact.

## 14. Font handling

- Use Google Fonts as the primary free web-font source.
- Proprietary or unavailable fonts are mapped to the closest free Google Font match.
- System fallbacks are declared in `brand-guidelines` typography rules.

## 15. Form handling and dynamic content

- Phase 2.
- We will eventually need a form-submission backend and possibly a database for dynamic content.

## 16. Responsive breakpoints

Target three breakpoints:

- Desktop: 1440px
- Tablet: 768px
- Mobile: 375px

Generated sites must work correctly at all three.

## 17. Visual QA automation depth

- Run QA on every generated page.
- Use automated screenshot diff + vision model summaries to find issues.
- Loop to fix issues up to the configured max iterations.
- If the user rejects the result, they refine it through the AI Assistant.
- QA is issue-based, not a single score. See `evals-and-self-healing.md`.

## 18. LLM routing and prompt architecture

- Break generation into small, precise prompts: blueprint, copy, assets, code, QA.
- Use system prompts that users cannot edit.
- Layer in relevant docs (workspace memory, brand guidelines, business info, voice copy) per prompt.
- Prompts are versioned with code, not user-editable.
- LLM provider is selected via the `LLM_PROVIDER` env config (`openrouter` or `ollama`).

## 19. Error handling and partial success

- Page-level failures are isolated.
- A partial site can still be previewed and published.
- Failed pages are surfaced in the job report.

## 20. Cost attribution and workspace credits

- Every pipeline phase is logged to `ai_activity` with model, tokens, cost, latency, and outcome.
- Phases: `blueprint`, `copy`, `assets`, `code`, `qa`.
- Workspaces have a monthly credit pool.
- Credits refresh on the workspace's Stripe subscription renewal date (successful rebill).
- Out of credits = jobs pause until re-up.

## 21. Site identity and URLs

- Each site gets a preview domain and a publish domain.
- Preview URLs are workspace-member-only.
- For phase 1, use a simple subdomain format (e.g. `{site-slug}-{hash}.yourdomain.com` or similar). For local dev, use `/etc/hosts` entries like `pushpress.site`.
- Target branded domain format for production (e.g. `{site-slug}.pushpress.site` for publish, `preview-{hash}.pushpress.site` for preview).
- Custom domains are phase 2.
- Track deployment history; consider git-like history per site in the future.

## 22. Security

- **Phase 1:** use local temp directories for builds. Accept the sandbox risk until the website builder is proven.
- **Phase 2:** move to isolated sandboxes (Docker/E2B/Firecracker) before production or before supporting user-provided custom code.

## Tech choices

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Static site framework | Astro 5.x | Existing renderer stack; excellent static output and partial hydration. |
| Styling | Tailwind CSS | Matches renderer; tokens map to utilities. |
| Component registry | Astro components + Zod props | Type-safe; new section types are additive. |
| Build sandbox | Local temp directory for PoC; E2B/Docker for production | Fast iteration now; isolation later. |
| Screenshots / QA | Playwright | Already used for scraping. |
| Image generation | Flux / Ideogram via API; DALL-E fallback | Best web asset quality. |
| LLM routing | Configurable via `LLM_PROVIDER` env (`openrouter` or `ollama`) | Already added to env schema. |
| Default LLM | `anthropic/claude-3.5-sonnet` (OpenRouter) / `qwen2.5:32b` (Ollama) | Strong coding and JSON generation. |
| Vision LLM | `openai/gpt-4o` (OpenRouter) / `llava:34b` (Ollama) | Screenshot QA and diff summaries. |
| Cheap LLM | `google/gemini-flash-1.5` (OpenRouter) / `qwen2.5:7b` (Ollama) | Fast tasks like prompt cleanup. |
| Orchestration | BullMQ jobs in `apps/api` | Step-level status, retries, cost tracking via `ai_activity`. |

## API entry point

`POST /workspaces/:workspaceUuid/sites/:siteUuid/generate`

Body:

```json
{
  "mode": "greenfield" | "replication",
  "input": {
    "brief": "A Brooklyn gym...",
    "target_url": "https://example.com/"
  },
  "options": {
    "pages": ["index", "about", "programs"],
    "max_qa_iterations": 3,
    "replication_scope": "homepage" | "all_linked_pages"
  }
}
```

Response:

```json
{
  "aiJobUuid": "...",
  "status": "pending",
  "estimatedDurationSeconds": 180
}
```

The job progresses through pipeline states. Each state transition is logged to `ai_activity`.

## Data model updates

- `ai_jobs` — add `state` and `steps` JSON to track pipeline progress.
- `ai_job_steps` — optional per-step table for status, logs, outputs, cost, latency.
- `deployments` — connect successful builds; add `status: ready_for_review | published | rejected`.
- `components` registry table — store system + workspace section types with schema and source code pointer.
- `blueprints` table — store the generated blueprint per site so the editor can load and mutate it.

## Open questions

1. **Replication scope.** ✅ **Decision: record the full site tree, generate homepage first with approval gate, then generate remaining pages from the locked baseline.**
2. **Component registry ownership.** ✅ **Decision: system-wide components first, with workspace-level overrides later.** Components support variants.
3. **Build sandbox.** ✅ **Decision: local temp directory for the PoC; E2B/Docker planned for production.**
4. **PushPress data integration.** ✅ **Decision: phase 2.**
5. **Asset rights for replication.** ✅ **Decision: scrape originals into the asset library and use them directly.**
6. **Cost and timeout caps.** ✅ **Decision: defaults are per-workspace configurable settings.**
7. **Editor.** ✅ **Decision: no editor in phase 1.**
8. **Deployment hosting.** ✅ **Decision: S3 + CloudFront.**
9. **Preview URL auth.** ✅ **Decision: workspace-member-only.**
10. **Renderer app role.** ✅ **Decision: `apps/renderer` is a template/component library; `apps/api` spawns per-job builds.**
11. **Astro source storage.** ✅ **Decision: S3 prefix. Source at `sites/{siteUuid}/source/{attemptId}/`, built `/dist` at `sites/{siteUuid}/dist/{attemptId}/`.**
12. **Credit system.** ✅ **Decision: credits refresh on Stripe subscription renewal date after successful rebill.**
13. **Preview/publish domain format.** ✅ **Decision: phase 1 uses any simple subdomain; target `{site-slug}.pushpress.site` / `preview-{hash}.pushpress.site` for production; use `/etc/hosts` for local dev.**
14. **Self-healing approval.** ✅ **Decision: auto-apply during build/self-healing; confirm with user only when AI Assistant changes site-wide styles.**
15. **Component model.** ✅ **Decision: Model B — each generated site owns its full Astro component tree. System components are starting templates only.**
16. **URL replication and third-party embeds.** ✅ **Decision: not for now; phase 2.**
17. **Sandbox now vs. later.** ✅ **Decision: temp directories for phase 1; isolated sandboxes once the website builder is proven.**

## Implementation sequence

1. Component registry + 5–8 core section types.
2. Blueprint JSON schema in `packages/shared-types`.
3. Code generator: blueprint → Astro files → static build in temp directory.
4. Wire generator to a BullMQ `ai_job` and API endpoint.
5. Automated structural QA (build, links, console, responsive).
6. Asset engine for images, logos, favicons.
7. Copy engine for greenfield content.
8. URL replication crawler + scraper integration.
9. Visual QA diff loop (automated, issue-based).
10. Human review gate and publish flow.
11. Blueprint editor integration.
