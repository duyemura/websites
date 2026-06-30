# Asset Classification and Metadata Pipeline

## Status

Draft — ready for review before implementation.

## Context

The platform now stores three classes of assets in the `assets` table:

- `upload` — images/fonts/documents uploaded by workspace members.
- `scraped` — images/fonts discovered during website replication and downloaded to workspace-local S3.
- `screenshot` — internal QA screenshots (reference screenshots, scrape screenshots). Hidden from the assets UI.
- `ai_generated` — reserved for images/fonts created by AI (out of scope for this doc).

This doc designs the next layer: automatically classifying, tagging, and enriching every non-screenshot asset with metadata so marketing and site-building features can pick the right image for the right job.

## Goals

1. Every `upload` and `scraped` asset gets analyzed once by a vision-capable LLM.
2. Extract and record technical metadata and EXIF-like fields.
3. Produce marketing-relevant tags and an SEO alt-text suggestion.
4. Store everything in the existing `assets.metadata` column so queries stay simple.
5. Run asynchronously via BullMQ so analysis never blocks uploads or scrapes.
6. Log cost/latency to `aiActivity` like every other LLM call.

## Non-goals

- Image manipulation (resize, crop, format conversion). That belongs to a later optimization worker.
- AI image generation. That belongs to the `generate_assets` worker and is out of scope here.

## Data model

No schema changes required. We extend `assets.metadata` with a new `analysis` object.

### `assets.metadata.analysis` shape

```json
{
  "analysis": {
    "analyzedAt": "2026-06-30T20:00:00.000Z",
    "model": "gemma4:31b-cloud",
    "version": 1,

    "description": "A coach spotting a barbell back squat in a bright gym.",
    "altText": "Coach spotting a member during a barbell back squat at a gym.",

    "context": "hero",
    "confidence": 0.92,

    "tags": [
      "people",
      "gym",
      "coaching",
      "barbell",
      "bright",
      "action",
      "hero-candidate"
    ],

    "technical": {
      "width": 1920,
      "height": 1080,
      "format": "image/png",
      "hasTransparency": false,
      "dominantColors": ["#1a1a1a", "#f5f5f5", "#d4af37"],
      "hasText": false,
      "textConfidence": 0.02,
      "faces": 2,
      "people": 2
    },

    "quality": {
      "score": 4,
      "resolution": "high",
      "sharpness": "good",
      "issues": ["slight motion blur on hands"]
    },

    "marketing": {
      "mood": "energetic",
      "useCases": ["hero", "program-page", "social-post"],
      "subject": "coach-member interaction",
      "brandFit": null
    },

    "safety": {
      "hasIdentifiablePeople": true,
      "needsReview": false
    }
  }
}
```

### Top-level metadata additions

| Field | Source | Purpose |
|-------|--------|---------|
| `metadata.analysis` | LLM + local extraction | Classification, alt text, tags, quality. |
| `metadata.exif` | Sharp / exifreader | Camera, date, location if embedded (stripped before public display). |
| `metadata.dimensions` | Sharp | Width/height for layout decisions. |
| `metadata.fileSize` | S3 head / buffer | Bytes, for performance budgets. |

## Pipeline

### Trigger points

1. After `POST /assets` succeeds for `upload` assets.
2. After `downloadScrapedAssets` succeeds for each newly created scraped asset.
3. Backfill: a periodic or on-demand job that finds `assets` rows where `metadata->analysis` is missing and `source != 'screenshot'`.

### Worker: `classify_assets`

Add a new BullMQ queue and worker `classify_assets`.

Payload:

```ts
interface ClassifyAssetsJob {
  workspaceUuid: string;
  assetUuid: string;
}
```

Worker steps:

1. Load the asset row. Skip if `source === 'screenshot'` or `metadata.analysis.version >= CURRENT_VERSION`.
2. Stream the asset from S3.
3. Run local extraction with Sharp (or exifreader) for dimensions, format, dominant colors, EXIF.
4. Base64-encode a downscaled version for the vision model.
5. Call the vision LLM with a structured prompt and JSON schema.
6. Merge LLM output with local extraction.
7. Update `assets.metadata` with the analysis object.
8. Log the call to `aiActivity` with action type `analyze`, model, tokens, cost, latency, and outcome.

### Prompt design

Two prompts:

- `asset-vision-analysis` — describes the image and returns classification/quality/tags.
- `asset-alt-text` — given the analysis result, produces concise SEO alt text.

They can be separate LLM calls or one call with a combined schema. Start with one call for cost efficiency; split if quality suffers.

### Model selection

Use the existing `asset-curator` / `vision` task mapping in `model-picker.ts`:

```ts
modelForAgent("asset-curator", config); // -> config.VISION_LLM_MODEL
```

## API changes

### `GET /api/assets`

Already excludes screenshots. Optionally accept query params for filtering:

- `?tag=hero-candidate`
- `?useCase=hero`
- `?minQuality=3`
- `?source=scraped`
- `?analyzed=true`

Keep the first version simple: add `?tag=` and `?source=`.

### `GET /api/assets/:uuid`

Returns the analysis object inside `metadata` so the workspace UI can show tags, alt text, and quality score.

### `POST /api/assets/:uuid/regenerate-analysis`

Admin/debug endpoint to force re-analysis (bumps `analysis.version`).

## Marketing feature integration

### Hero/logo selection during replication

`site-blueprint.ts` already picks `data.images.find(i => i.context === 'hero')`. After classification, prefer images where:

- `analysis.context === 'hero'` or `analysis.marketing.useCases` contains `'hero'`.
- `analysis.quality.score >= 3`.
- `analysis.technical.width >= 1200`.

### SEO alt text

When a page section uses a scraped/uploaded image, use `metadata.analysis.altText` if available; fall back to `image.alt` or `asset.name`.

### Content generation workers

Blog, pillar-page, and social-post workers can query assets by tag/useCase and include the winning image URLs in their prompts.

### Asset curation UI

The workspace assets page can surface:

- Quality score badge.
- Auto-generated tags.
- Suggested alt text (editable).
- Warnings: "low resolution", "identifiable people", "needs review".

## Implementation plan

1. Add `classify_assets` queue and worker skeleton.
2. Add local metadata extraction utility using Sharp (add dependency).
3. Add vision prompt and JSON schema for asset analysis.
4. Add alt-text prompt.
5. Wire `classify_assets` enqueue after `POST /assets` and `downloadScrapedAssets`.
6. Add backfill command or route.
7. Extend `GET /api/assets` with `tag` and `source` filters.
8. Add tests: worker happy path, skip screenshots, merge local/LLM metadata, filter behavior.

## Open questions

1. Should analysis run for `font` and `document` assets too, or only images?
2. Do we want to cache/persist the downscaled image sent to the LLM?
3. Should low-quality or people-containing assets be hidden by default until reviewed?
4. Which workspace members can edit auto-generated alt text and tags?
5. Should the prompt include brand guidelines so `brandFit` can be scored?

## Related files

- `apps/api/src/utils/scraped-assets.ts` — downloader that will enqueue analysis.
- `apps/api/src/api/routes/assets.ts` — route that will enqueue analysis after upload.
- `apps/api/src/ai/model-picker.ts` — agent-to-model mapping.
- `apps/api/src/services/ai-activity.ts` — LLM logging.
- `apps/api/src/plugins/queues.ts` — queue registration.
