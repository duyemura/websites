# Site-generation pipeline restructure — design spec

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Branch context:** `feat/asset-classification-metadata-pipeline` (builds on the shipped three-doc refactor: `site-hierarchy`, `design-system`, `section-visual-evidence`)

---

## 1. Goals

Restructure the Milo Gyms site-generation pipeline in `apps/api` into five discrete, re-runnable, page-scoped stages that produce a true clone of an arbitrary gym website — one the gym owner can adjust as needed — plus the durable docs that power future marketing/business tooling.

**Problems this solves (from the 40-gym eval):**

- 17/40 sites return < 3 sections (SPA/Squarespace div-soup)
- 5 sites time out on `networkidle`
- 2 SPA sites produce empty static-HTML sections
- Wrong business names (QR-code alt text picked over structured data)
- Single-page only — no multi-page site cloning
- No interaction states, no breakpoint fidelity, no verification loop

**Three modes, same stages:**

| Mode | Input | Behavior |
|---|---|---|
| Clone | one URL | Extract + Segment on that site; docs from its artifacts |
| Hybrid | two URLs | Content docs from site A's artifacts, design docs from site B's |
| Greenfield | no URL | Skip Extract/Segment; docs from brand settings + default skeleton |

---

## 2. Foundation: Playwright-primary, HTML-assist, vision-accessory

**Playwright is the pipeline.** The hard problems (SPA, div-soup, interactions, breakpoints, exact colors, real media URLs) are only solvable with a live browser. HTML analysis adds cheap high-confidence structure on well-built sites. Vision fills gaps where the browser's output is ambiguous, and verifies at the end.

| Problem | Why vision/HTML can't solve it | Playwright solution |
|---|---|---|
| SPA sites | Static HTML is an empty root div | JS executes; rendered DOM has everything |
| div-soup | No semantic markup to parse | `getComputedStyle()` + layout geometry sees rendered structure |
| Exact colors | Vision guesses from pixels | Computed styles + CSS custom properties give exact values |
| Fonts | Vision can't read font-family | Loaded stylesheets give exact stacks/weights/sizes |
| Breakpoints | Vision needs screenshots per width + diffing | Resize viewport, re-run `getComputedStyle()`, diff — pure data |
| Interaction states | Static screenshot shows default state only | Click/hover + before/after capture |
| Real media URLs | DOM `src` lies (lazy-load, srcset, JS-injected) | Network interception captures actual requests |
| Lazy content | Absent from static HTML | Scroll pass triggers loading |

**Vision's three jobs (accessory only, ~3–4 calls/site, ~$0.05):**

1. Section segmentation fallback on div-soup sites
2. Interaction interpretation (what component is this before/after pair?)
3. Final verification (clone vs. original comparison)

Vision never extracts colors, fonts, or content — Playwright already has those exactly.

---

## 3. Pipeline overview

```
Extract → Segment → Doc-gen → Build → Verify
```

- Each stage has its own endpoint: `POST /sites/:uuid/pipeline/:stage`
- Each stage reads the previous stage's saved artifact — no stage revisits the live site except Extract
- Each stage is page-scoped: `{ pages?: string[] }` limits scope (dev on homepage only, then widen); artifacts are page-keyed and merge-on-write
- Artifacts (mechanical, regenerable, pipeline-internal) are distinct from docs (durable, LLM-readable, evolve with the site)

---

## 4. Extract stage

**Purpose:** One Playwright session per source URL captures everything downstream stages need. Hybrid mode = two Extract runs.

**Input:** `{ url, pages?, maxPages? }` · **Output:** `extract-artifact` + screenshots in S3

### Step 0 — Page discovery (site map)

1. `sitemap.xml` / `robots.txt` — authoritative page list if present
2. Rendered nav links (header + footer), same-origin
3. Internal link sweep of homepage, deduped/normalized

Classify each URL:

| Classification | Examples | Action |
|---|---|---|
| structural | home, about, pricing, `/programs`, `/programs/crossfit`, blog **index** | full capture (within cap) |
| collection-exemplar | one representative blog post per detected collection | full capture, tagged as template exemplar |
| ugc-instance | remaining blog posts / news / event write-ups | listed in siteMap, skipped (`skipReason: "user-generated-content"`) |
| boilerplate | privacy, terms | listed, skipped |

- The rule is **unique template vs. repeated content instance**, not URL depth. Business subpages (`/programs/yoga`, `/locations/downtown`) are structural.
- Repeated-template detection: many URLs sharing a path prefix with near-identical DOM structure → collection; capture index + one exemplar.
- **Cap: 50 structural pages** (rank: nav-linked, then footer-linked, then orphans). Overridable per request.
- Skipped URLs remain in the map — inventory for a future blog scrape/import tool.

### Steps 1–11 — Per-page capture (shared browser context; cookies/cache persist across pages)

1. **Network interception** — armed before navigation. Records every image/video/font/CSS request: final CDN URLs, content types, sizes. The network never lies; DOM `src` does.
2. **Navigate with `domcontentloaded` + ~3s settle** — not `networkidle` (chat widgets/analytics keep connections open forever; fixes the 5 timeout sites).
3. **Scroll pass** — viewport-height steps top to bottom (~500ms each), back to top. Triggers lazy-loading, reveals below-the-fold media to the interceptor.
4. **CSS extraction** (homepage fully; other pages diff for page-specific sheets) — via `page.evaluate()` over `document.styleSheets`: `:root` custom properties → exact design tokens; `@media` conditions → real breakpoint values; `@keyframes` + transitions → animation inventory. Cross-origin sheets fetched by URL and parsed as text.
5. **Full-page screenshot @ 1440** → S3.
6. **Content extraction on the rendered DOM** — `innerText`, headings, links/nav, meta/OG, JSON-LD, iframe inventory (maps/schedules/forms), video embeds. Business name from JSON-LD/OG-title **before** any image-alt fallback (fixes wrong-name bug). Rendered DOM fixes empty-SPA extraction.
7. **Interaction capture** — candidates: `aria-expanded`, `aria-haspopup`, `<details>`, hamburger/accordion/tab class patterns. For each (cap ~8/page): region screenshot → hover/click → 300ms → screenshot → reset (Escape/click-away). Record before/after computed-style diff of the affected subtree.
8. **Re-extract at 375 and 768** — `setViewportSize()`, re-run scroll + viewport screenshot + slim computed-style pass on tracked elements. Cross-width diffs = per-breakpoint deltas as pure data (zero vision).
9. **Pixel sampling** — grid sample of the screenshot buffer (backgrounds, buttons, text); catches colors applied via images/gradients; cross-checks step 4.
10. **SPA / div-soup detection** — static-HTML text length vs. rendered `innerText` length; semantic element count → `needsVisionSegmentation`, `isSpa` flags.
11. **Source baseline capture** (while the original is live — it may be gone by Verify time):

| Baseline | Tool | Scope |
|---|---|---|
| Performance | Lighthouse programmatic (mobile + desktop presets) | homepage + nav pages, cap ~10 |
| Accessibility | axe-core in-page | every captured page |
| SEO/AEO | meta/schema/alt/heading data (already captured step 6) | every captured page |
| Page weight/requests | from network interception (total bytes, request count, image bytes) | every captured page |

### Extract artifact shape

```ts
type ExtractArtifact = {
  url: string; extractedAt: string;
  siteMap: Array<{
    url: string; path: string; title: string;
    classification: "structural" | "collection-exemplar" | "ugc-instance" | "boilerplate";
    source: "sitemap" | "nav" | "footer" | "link-sweep";
    status: "captured" | "skipped"; skipReason?: string;
  }>;
  css: { tokens: Record<string, string>; breakpoints: string[]; animations: AnimationEntry[] };  // site-global
  pages: Array<{
    path: string;
    media: NetworkMediaEntry[];
    screenshots: { full1440: string; vp375: string; vp768: string };  // S3 URLs
    content: { title: string; businessName?: string; headings: Heading[]; navLinks: NavLink[]; meta: MetaTags; jsonLd: unknown[]; iframes: IframeEntry[]; videos: VideoEntry[] };
    interactions: InteractionCapture[];   // before/after shots + style diffs
    responsive: BreakpointDelta[];        // computed-style diffs across 375/768/1440
    pixelSamples: Array<{ point: Point; hex: string }>;
    flags: { needsVisionSegmentation: boolean; isSpa: boolean };
  }>;
  sourceBaseline: {
    capturedAt: string;
    lighthouse: Array<{ path: string; preset: "mobile" | "desktop"; performance: number; seo: number; accessibility: number; bestPractices: number }>;
    axe: Array<{ path: string; violations: AxeViolation[] }>;
    network: Array<{ path: string; totalBytes: number; requestCount: number; imageBytes: number }>;
  };
  usage: { pagesCaptured: number; screenshotCount: number };  // metering hook for future usage-based billing
};
```

---

## 5. Segment stage

**Purpose:** Cut each captured page into an ordered list of typed sections with exact bounding boxes and crops. Playwright answers "where are the boundaries"; a text LLM answers "what is this"; vision only rescues div-soup.

**Input:** `extract-artifact` + Playwright session re-opened at each page URL · **Output:** `segment-artifact` (per-page)

### The confidence ladder

**Rung 1 — Semantic DOM query (confidence 0.9).** `page.evaluate()` scan for `header, footer, main, nav, section, article` + ARIA landmark roles; `locator.boundingBox()` per hit. Zero LLM cost; sufficient on ~60% of sites.

**Rung 2 — Visual boundary scan (confidence 0.6)** — when Rung 1 finds < 3 sections. Injected script walks top-level containers detecting **rendered** boundaries: background color/image changes between adjacent large blocks, vertical gaps > ~80px, full-width dividers. Real bounding boxes from layout. This is the div-soup fix — Squarespace nested divs still *render* as visually distinct bands.

**Rung 3 — Vision fallback (confidence 0.75)** — when Rungs 1+2 still yield < 3 sections OR `needsVisionSegmentation`. Full-page screenshot (already in S3) → `{type, y_start_pct, y_end_pct}` per section → pixel boxes. ~1 call, expected only on the worst sites.

### Post-ladder passes

- **Classification:** one batched text-LLM call — `{heading, first 300 chars}` per section → `CanonicalSectionTag` (shipped union). Structurally identified header/footer/nav skip the LLM.
- **Merge/dedup:** `semantic > visual-boundary > vision`; >70% vertical overlap collapses into higher-confidence box.
- **Gap fill:** uncovered vertical spans > 200px become `unknown` sections. Never silently drop content.
- **Crop generation:** `page.screenshot({ clip: boundingBox })` per section at 1440; re-measure at 375 and clip again. Pixel-exact (browser owns layout; no post-hoc sharp math). Crops → S3.

### Cross-page shared-component fingerprinting

Components are **never shared across websites** — this is within-site dedup only.

Fingerprint per section: canonical tag + normalized innerText hash + media URL set + bounding-box aspect ratio. For structure-identical sections on 2+ pages, measure text similarity and resolve **deterministically — no human gate**:

| Similarity | Decision | Behavior |
|---|---|---|
| ≥ 95% | Promote + normalize | Differences are drift (typo'd phone number, stale hours). Canonical = most frequent variant; homepage wins ties. Normalizations logged to `site-memory`. The clone fixes the sloppy site. |
| 70–95% | Promote with props | Same structure, intentional per-page variance. One shared `.astro` component with props for divergent fields (mechanically identified by diffing variants); per-page values live in `site-hierarchy`. |
| < 70% | Keep separate | Same tag coincidence, not the same component. |

Homepage-only runs produce zero shared components (needs 2+ pages) — expected during development.

### Segment artifact shape

```ts
type SegmentArtifact = {
  siteUuid: string; sourceExtractAt: string;
  pages: Array<{
    path: string;
    sections: Array<{
      id: string; tag: CanonicalSectionTag; order: number;
      confidence: number; source: "semantic" | "visual-boundary" | "vision";
      boundingBox: BBox;            // at 1440
      boundingBox375?: BBox;
      crops: { desktop: string; mobile: string };  // S3
      innerText: string; headingText?: string;
      mediaUrls: string[];          // network-captured media within bbox
      interactionIds: string[];
      sharedComponentId?: string;   // set by fingerprinting
      sharedProps?: Record<string, string>;  // per-page values for promoted-with-props
    }>;
    ladder: { rung1Count: number; rung2Used: boolean; visionUsed: boolean };
  }>;
  sharedComponents: Array<{
    id: string; tag: CanonicalSectionTag;
    memberSectionIds: string[];     // page/section refs
    resolution: "normalized" | "props";
    propFields?: string[];
  }>;
};
```

---

## 6. Doc-gen stage

**Purpose:** Transform mechanical artifacts into durable, LLM-readable docs. This is where the three modes diverge.

**Input:** extract + segment artifacts (clone: one pair; hybrid: two; greenfield: none) · **Output:** the 9 docs

> Doc *content* details (exact fields, prose formats) get their own working session before implementation; the shipped doc builders (`site-hierarchy-builder`, `design-system-builder`, `section-visual-evidence-builder`, business-info extraction) are the starting inspiration.

### Doc taxonomy (9 active docs, organized by consumer)

**Category 1 — Build docs (pipeline → 100% quality clone):**

| Doc | Contents |
|---|---|
| `design-system` | Locked tokens (exact hexes/fonts from CSS), breakpoint thresholds from real `@media` values, per-breakpoint responsive rules (`BreakpointDelta[]`), interaction/transition styles, header/footer shell |
| `site-hierarchy` | All pages + sections with content and intent, shared-component pointers + per-page props, build plan/order — content source of truth |
| `section-visual-evidence` | Per-section crops (desktop + mobile), computed styles, interaction before/afters with interpreted `componentPattern` (`dropdown \| accordion \| tab \| modal \| ...` — the one vision-accessory call per interactive component), network-captured media URLs |

**Category 2 — Marketing Assistant context:**

| Doc | Contents |
|---|---|
| `search-presence` **(new)** | Day-zero SEO/AEO snapshot: per-page meta titles/descriptions, heading structure, JSON-LD/schema types, canonical/OG/alt coverage, sitemap health, keyword/topic footprint, plus the `sourceBaseline` summary. Measured-improvement baseline for the future Marketing Assistant. |
| `site-strategy` (repurposed) | Conversion goals, page purposes, CTA strategy, audience/positioning from site + GMB. Bridge doc: Build uses intent; Marketing Assistant uses campaign alignment. |

**Category 3 — Business context:**

| Doc | Contents |
|---|---|
| `business-info` (enriched) | Fed by up to 50 pages: offerings/programs, pricing, staff/coach bios, locations, hours, contact, socials |
| `brand-guidelines` | Voice/tone from copy, visual identity, logo assets, imagery style |

**Category 4 — History:**

| Doc | Contents |
|---|---|
| `site-memory` | Append-only activity log: scraped/built/edited/re-skinned/normalized, timestamps + actor |
| `workspace-memory` | Cross-site workspace knowledge (unchanged) |

**Deliberately not docs (yet):** keyword research, blog calendars, ad analyses (Marketing Assistant writes these later — registry accepts new keys when those ship); competitor/local-market data (runtime work); media inventory (lives in `assets` table).

**Net change from shipped state:** retire `blueprint-draft`, add `search-presence`, enrich `design-system` / `section-visual-evidence` / `business-info` / `site-strategy`.

### Mode divergence

- **Clone:** one artifact pair feeds everything.
- **Hybrid:** `site-hierarchy`, `business-info`, `site-strategy`, `search-presence`, content in `site-memory` ← site A. `design-system`, `brand-guidelines` ← site B. `section-visual-evidence` ← **site B's rows**, matched to A's sections by canonical tag; unmatched A-sections fall back to design-system rules. Works because content/design separation is already enforced.
- **Greenfield:** default homepage skeleton (`hero`, `feature-grid`, `testimonial-band`, `cta-band`, `location-block`) + LLM copy from business inputs; `design-system` from brand settings; `section-visual-evidence` and `search-presence` empty-with-note.

Endpoint: `POST /sites/:uuid/pipeline/docgen { contentSiteUuid?, designSiteUuid? }`.

---

## 7. Build stage

**Purpose:** Turn the 9 docs into a working Astro site, page by page. Docs are the contract — Build never reads artifacts.

**Input:** docs · **Output:** Astro project files; `site-hierarchy.buildPlan` statuses updated

### Renderer split (shipped principle, enriched inputs)

- **Semantic shell renderers** — `header`, `hero`, `footer`: deterministic TypeScript renderers (every page, pixel-consistent), fed from `design-system.global.shell` + hierarchy content.
- **`renderVisualBlock`** — everything else: vision-capable LLM writes one `.astro` component per section.

### renderVisualBlock prompt inputs

1. Section crop **desktop + mobile** — LLM sees the actual responsive target
2. Computed styles — layout/spacing reference (colors always from locked tokens, never vision)
3. **Breakpoint deltas pre-translated to Tailwind** by deterministic mapping code (`flexDirection row→column below 768px` → "use `flex-col md:flex-row`") — the LLM receives instructions, not raw diffs
4. Interaction pattern + before/after style diff → Alpine.js state + CSS transitions (Alpine already in the Astro stack; pure CSS for hover)
5. Locked tokens + global rules
6. Neighbor section tags for spacing coherence

### Shared components

Sections with `sharedComponentId` render **once** → `src/components/shared/{id}.astro`; pages reference it (with props where `resolution: "props"`). Edit the map block once, all pages update. Cuts LLM calls ~30–40% on multi-page sites. Un-sharing later = clear the pointer, regenerate that page. Collection-exemplar templates are registered for the future blog-import tool.

### Deterministic passes around the LLM

- **Pre-pass:** token CSS variables file, font loading, breakpoint config, download/re-host all network-captured media into the project (no hotlinking source sites)
- **Post-pass:** `astro check` per generated component → one automatic retry with error appended → second failure falls back to the deterministic fallback block and is flagged in the build report

### Scope + cost

`POST /sites/:uuid/pipeline/build { pages? }` — per-page re-runnable. ~1 LLM call per non-shell, non-shared section; a 10-page site ≈ 50–60 small parallelizable calls.

---

## 8. Verify stage

**Purpose:** Score the clone against the original mechanically and visually; produce an actionable, client-facing report. Also the engine of the eval harness. Verify reports; the caller decides — no internal retry loop.

**Input:** built site (local preview) + extract-artifact (screenshots + `sourceBaseline`) · **Output:** `verify-artifact`

### Layer 1 — Mechanical checks (Playwright on the clone, no LLM)

- Renders without console errors; all in-scope pages return 200
- Every `site-hierarchy` section id present in rendered DOM
- Token audit: rendered computed colors/fonts match `design-system` exactly
- Media audit: all re-hosted images load; no hotlinks to source
- Breakpoint audit: Extract's computed-style diff pass re-run on the clone at 375/768/1440, diffed against the original's `BreakpointDelta[]`
- Interaction audit: captured interactions replayed on the clone (accordion opens?)

### Layer 2 — Vision comparison (~2 calls/page)

Clone full-page screenshots at 1440 + 375 vs. original's, side-by-side: score 0–100, list concrete differences, ignore intentional content changes.

### Scores — two families

**Family 1 — Fidelity (clone vs. original):**

| Score | Source |
|---|---|
| Mechanical fidelity (0–100) | % Layer-1 checks passed, weighted (missing sections/broken media/dead interactions weigh heaviest) |
| Visual fidelity (0–100) | Vision comparison averaged across viewports/pages |
| **Master fidelity** | Weighted blend (50/50 initial; eval data tunes it). **Cap rule:** any critical mechanical failure caps master at 79 — prevents "looks right, is broken" scoring well. |

**Family 2 — Quality (clone absolute + delta vs. `sourceBaseline`):**

| Score | How |
|---|---|
| Performance | Lighthouse on clone, delta vs. baseline |
| SEO/AEO | Meta/schema/alt/heading scoring vs. `search-presence` baseline |
| Accessibility | axe-core on clone, delta vs. baseline violations |

### Improvements — "pixel-faithful design, better bones"

The system never changes what the visitor sees or what content says, but always upgrades what's underneath (on by default): semantic HTML, image optimization (responsive sizes, modern formats, lazy-load), meta/schema completion from `business-info`, alt-text generation, near-match normalizations.

Every improvement is **reported, never silent** — from two mechanical sources:

1. **Build-time logs** — things actively done (normalizations, alt text, media optimization)
2. **Verify-time baseline diffs** — computed receipts, no LLM claims: schema types absent→present, semantic element counts, axe violations fixed, page-weight reduction, meta coverage. The LLM only phrases them, never invents them.

Anything that would alter visuals or content meaning is out of pipeline scope — future Marketing Assistant surfaces those as suggestions.

### Verify artifact shape

```ts
type VerifyArtifact = {
  pages: Array<{
    path: string;
    mechanical: { passed: Check[]; failed: Check[] };
    vision: { score1440: number; score375: number; differences: string[] };
  }>;
  scores: {
    mechanicalFidelity: number; visualFidelity: number; masterFidelity: number;
    quality: { performance: ScoreDelta; seo: ScoreDelta; accessibility: ScoreDelta };
  };
  improvements: Array<{
    category: "semantics" | "performance" | "seo" | "accessibility" | "consistency";
    source: "build-log" | "baseline-diff";
    description: string; page?: string;
  }>;
  actionable: Array<{ page: string; sectionId?: string; issue: string; suggestedStage: "extract" | "segment" | "docgen" | "build" }>;
};
```

`actionable` routes each failure to the stage to re-run — the self-healing hook for the eval loop.

---

## 9. API surface, storage, eval alignment, migration, testing

### API

```
POST /sites/:uuid/pipeline/extract   { url?, pages?, maxPages? }   // url omitted = re-run stored source
POST /sites/:uuid/pipeline/segment   { pages? }
POST /sites/:uuid/pipeline/docgen    { contentSiteUuid?, designSiteUuid? }
POST /sites/:uuid/pipeline/build     { pages? }
POST /sites/:uuid/pipeline/verify    { pages? }
POST /sites/:uuid/pipeline/run       { url, mode, pages? }         // all five in order
GET  /sites/:uuid/pipeline/status    // per stage: last run, artifact version, scores
```

Stages run as BullMQ jobs (long-running, browser-bound); POST returns a job id. Re-running a stage bumps its artifact version; downstream stages **warn, not block**, when their input artifact is newer than their last run.

### Artifact storage

New `pipeline_artifacts` table: `{ siteUuid, stage, version, payload JSONB, createdAt }` — keep last 3 versions per stage. Screenshots/crops in S3 under `workspaces/{ws}/sites/{site}/pipeline/{stage}/...`, referenced by URL. Docs stay in the existing `docs` table.

### Eval harness alignment

`scripts/eval/` becomes thin CLI wrappers over the same stage functions (no parallel implementations — that's how drift happened before). Flow: pipeline homepage-only across the 40-gym file → collect verify-artifacts → aggregate master fidelity + distributions into the eval report. `actionable` routing enables scripted self-healing: one automatic re-run of the suggested stage before a failure counts.

### Migration of existing sites

No backfill. Existing docs remain valid; sites keep working. A stage missing its input artifact returns a clear "run extract first" error. Re-running extract upgrades a site into the new world. (Shipped `blueprint-draft` → hierarchy migration covers pre-refactor sites.)

### Testing strategy

- **Unit:** fingerprinting/similarity thresholds, breakpoint-delta → Tailwind mapping, improvement diffing, page classification — pure functions, table-driven
- **Integration:** each stage against in-process local HTML fixtures (semantic site, div-soup site, fake SPA) — no network; headless Playwright in CI
- **Contract:** Zod validation of artifact schemas at stage boundaries — malformed input rejected loudly
- **E2E:** eval harness homepage-only over a 5-gym subset as smoke suite; full 40 on demand

### Development progression

Same mechanism as production page scoping, no dev mode: run all stages with `pages: ["/"]` → add one subpage → unscoped full site. Merge-on-write artifacts make each step additive.

---

## 10. Future considerations (explicitly out of scope)

- **Usage-based billing** for extra/difficult pages — the `usage` metering hook in extract-artifact records what's needed; pricing/billing designed later
- **Blog scrape/import tool** — consumes the siteMap's skipped `ugc-instance` inventory + the registered collection-exemplar template
- **Marketing Assistant** — consumes `search-presence`, `site-strategy`, `business-info`, quality-score history; writes its own doc keys when built
- **Re-skin flow** — already shipped; unchanged by this design (swap `design-system`, rebuild pages)
- **Doc content working session** — exact fields/prose formats for each doc before implementing Doc-gen

## 11. Open decisions to validate during implementation

1. Fingerprint similarity thresholds (95/70) are initial guesses — tune against the 40-gym eval set
2. Master fidelity weighting (50/50) — tune from eval data
3. Interaction-capture candidate heuristics — expand patterns as eval reveals misses
4. Lighthouse page cap (~10) — confirm sub-page scores are as uniform as expected
