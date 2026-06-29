# Website Generation System

## Goal

Build an API-invokable system that can generate or replicate static websites compiled with Astro. The output must be a deployable static bundle (`/dist`). When replicating an existing URL, the target is a pixel-perfect visual match.

This is the foundational capability of the product. All other features (editor, playbooks, AI chat) feed into or consume this pipeline.

## Operating principles

- **Blueprint first.** No code is written until the AI emits a validated JSON blueprint (pages, sections, tokens, assets). The blueprint is the single source of truth.
- **Source of truth is the build artifact.** A component or page is not considered done until the static build succeeds and visual QA passes.
- **No hallucinated dependencies.** Components use standard Astro patterns, Tailwind CSS, and workspace assets. No external UI libraries are installed unless explicitly configured.
- **Linear pipeline with a correction loop.** Work through ingestion → blueprint → assets → code → visual QA. The last two steps loop until the site passes.

## High-level pipeline

```
[Ingestion] → [Blueprinting] → [Asset Engine] → [Code Generation] → [Visual QA] → [Static Build]
                                           ↑                                     │
                                           └────────(loop on fail)──────────────┘
```

### 1. Ingestion

**Greenfield (text prompt):**
- Inputs: business description, desired pages, tone, reference docs (workspace memory, brand guidelines, offerings).
- Output: a structured brief: niche, audience, pages, sections, tone, must-use assets.

**Brownfield (URL replication):**
- Launch Playwright.
- Capture full-page screenshots at 1440px and 375px.
- Extract DOM structure, computed CSS design tokens, typography, images.
- Run the existing scraper to produce the structured site docs (brand guidelines, business info, site structure, voice copy, offerings, locations).

### 2. Blueprinting

The AI produces a strict JSON blueprint. This is the contract between ingestion and code generation.

```json
{
  "site_metadata": {
    "framework": "astro",
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
      "accent": "Rock Salt"
    },
    "spacing": {
      "max_width": "1280px",
      "section_padding": "96px"
    },
    "radius": "4px",
    "border_width": "8px"
  },
  "global_assets": {
    "favicon": "asset_uuid",
    "logo": "asset_uuid"
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
              "dimensions": [1440, 900]
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

**Validation:**
- JSON schema is validated by Zod.
- The blueprint references only component types registered in the component registry.
- All asset placeholders have a generation context or a source asset UUID.

### 3. Asset Engine

1. Walk the blueprint and collect every asset reference.
2. For each reference:
   - If it maps to an existing workspace asset (logo, uploaded photo), use it.
   - If it is missing, a placeholder, or low quality, generate an image.
   - For URL replication, prefer scraped images when legally/technically safe; otherwise generate replacements.
3. Generate images using an image-generation API (e.g. Flux, Ideogram). Prompts are built from the asset context + brand guidelines.
4. Save images to workspace-scoped storage with deterministic keys.
5. Update the blueprint with final asset URLs/storage keys.

### 4. Code Generation

1. Initialize a clean Astro project in a sandbox or ephemeral working directory.
2. Scaffold:
   - `src/layouts/Layout.astro` — global wrapper, fonts, meta, design tokens as CSS variables.
   - `src/components/` — one Astro component per registered section type.
   - `src/pages/[slug].astro` — one file per page, imports the layout and the ordered sections.
3. Render each blueprint section to its registered Astro component, passing content + assets + styles as props.
4. Use Tailwind CSS for all styling. Design tokens map to Tailwind config or CSS custom properties.
5. Install dependencies and run `astro build`.

**Component registry:**
A registry maps `component_type` values to Astro component implementations and a Zod schema for the section props. Adding a new section type means adding one registry entry (component + schema) without changing the orchestrator.

### 5. Visual QA / Correction Loop

1. Start a preview server for the built Astro site.
2. Use Playwright to capture full-page screenshots at 1440px and 375px.
3. For replications, compare against the reference screenshots.
4. A vision-capable model or diff tool evaluates:
   - layout alignment (element order, grid, spacing)
   - typography (font, size, weight, line height)
   - colors (backgrounds, text, accents)
   - asset rendering and cropping
   - responsive behavior
5. If issues are found, emit a structured bug log:
   ```json
   {
     "component_id": "hero",
     "issue": "headline font size too small",
     "required_change": "increase h1 from text-5xl to text-7xl",
     "severity": "high"
   }
   ```
6. Feed the bug log back into the code generation step and rebuild.
7. After a configured number of failures, stop looping and surface the best attempt + the unresolved issues to the user.

### 6. Static Build Output

- Run `astro build`.
- Validate that `/dist` contains clean HTML, CSS, JS islands, and optimized images.
- Upload `/dist` to the deployment artifact store.
- Create a deployment record and return the preview URL.

## Tech choices

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Static site framework | Astro 5.x | Already chosen in the project plan; excellent static output, partial hydration, SEO-first. |
| Styling | Tailwind CSS | Matches workspace/renderer stack; design tokens map cleanly to utilities. |
| Component registry | Astro components + Zod props | Keeps code generation simple and type-safe; new section types are additive. |
| Build sandbox | Local temp directory first; E2B or isolated container later | Fast iteration locally; isolate for untrusted/user-generated code in production. |
| Screenshots / visual QA | Playwright | Already used for scraping; same tool can drive the QA loop. |
| Image generation | Flux / Ideogram via API | Best quality for web imagery; fallback to a cheaper model for icons/backgrounds. |
| LLM for code | Claude / Qwen2.5-Coder / GPT-4o | Generate Astro components from blueprints. Route by task. |
| LLM for visual critic | Vision-capable model (Claude/GPT-4o/Qwen-VL) | Compare screenshots and emit bug logs. |
| Orchestration | BullMQ jobs in `apps/api` | Each generation is an `ai_job` with step-level status, cost tracking, and retries. |

## API entry point

`POST /workspaces/:uuid/sites/:uuid/generate`

Body:
```json
{
  "mode": "greenfield" | "replication",
  "input": {
    "brief": "..." // or
    "target_url": "https://example.com/"
  },
  "options": {
    "pages": ["index", "about"],
    "max_qa_iterations": 3
  }
}
```

Response:
```json
{
  "aiJobUuid": "...",
  "status": "pending",
  "estimatedDurationSeconds": 120
}
```

The job progresses through the pipeline states. Each state transition is logged to `ai_activity`.

## Data model updates needed

- `ai_jobs` already exists; add a `state` or `steps` field to track pipeline progress.
- Add an `ai_job_steps` table if we want per-step status, logs, and outputs.
- `deployments` already exists; connect successful builds to deployments.
- `components` registry table (optional): store system + workspace section types with schema and source code pointer.

## Open questions

1. **Perfect replication scope.** Is "pixel-perfect" judged on the homepage only, or every page? If every page, do we scrape all linked pages or only the provided URL?
2. **Component registry ownership.** Should section types be system-wide, workspace-specific, or both? Can a workspace define custom components?
3. **Build sandbox.** Do we need true sandboxing (E2B, Firecracker) for the build, or is a temp directory enough for the PoC?
4. **Visual QA threshold.** What match score counts as "good enough"? 98% is aspirational; should we start with human review and automated QA as a helper?
5. **Asset rights.** For URL replication, do we download and reuse the original images, always generate replacements, or let the user choose per asset?
6. **Cost and timeouts.** Image generation and multiple QA loops are expensive. What are the budget/time caps per job?
7. **Edit after generate.** Once a site is generated, does the user edit the blueprint JSON, the Astro code, or a visual editor? How do changes flow back?
8. **Deployment hosting.** Is the static build served from S3 + CloudFront, or do we use a separate hosting integration?
9. **Clerk / auth in generated sites.** Client sites are public, but preview URLs may need workspace auth. How do we handle that?
10. **Renderer app role.** Does `apps/renderer` become the build sandbox, or does `apps/api` spawn Astro builds directly? Should the renderer be a long-lived service or a CLI invoked per job?

## Implementation sequence (suggested)

1. Define the component registry and 5–8 core section types (Hero, Features, CTA, Testimonials, Pricing, Locations, Footer).
2. Define the blueprint JSON schema in `packages/shared-types`.
3. Build the code generator: from blueprint → Astro files → static build in a temp directory.
4. Wire the generator to a BullMQ `ai_job` and an API endpoint.
5. Add Playwright screenshot capture for generated output.
6. Add visual QA loop with a vision model.
7. Add asset generation for missing images.
8. Add URL replication path using the existing scraper as the ingestion step.
