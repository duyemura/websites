# Phase 1: Wholesale Site Mirror — Design

**Date:** 2026-07-04
**Status:** Approved
**Supersedes strategy of:** `2026-07-03-pipeline-restructure-design.md` (the pixel-fidelity replication chase). That spec's stage/artifact machinery remains; its goal changes.

## Strategy context

Milo is an AI marketing agent for gyms. The website is infrastructure the agent operates on, not the product. Onboarding is two-phase:

- **Phase 1 (this spec):** wholesale mirror of the gym's existing site — pixel-perfect by definition, live on Milo hosting in minutes. Puts domain, hosting, analytics, and lead capture under Milo control so off-site marketing starts immediately.
- **Phase 2 (separate spec):** brand-preserving rebuild on supported Astro templates, migrating **one route at a time** via `page-replace`. Never a big-bang cutover.

The existing extract/segment/docgen pipeline is retargeted at populating a **template-agnostic content model** (business info, brand tokens, typed content blocks). The pixel-fidelity self-heal loop is retired.

## Goals

1. Mirror any gym website (≤50 pages) to a static snapshot served from Milo infrastructure.
2. Serve on a preview subdomain instantly; on the gym's custom domain after a guided, verified DNS cutover.
3. Give the marketing agent a safe day-1 write surface (the transform layer) for SEO work on the frozen mirror.
4. Capture every native form submission as a Milo lead.
5. Preserve SEO exactly: URL paths, redirects, canonicals, sitemap.

## Non-goals (phase 2 or later)

- Template library, template matching/generation, `page-replace` implementation (only its **contract** is defined here)
- The marketing agent itself; GBP/ads integrations
- Billing, multi-language, sites >50 pages
- CMS/editing UI for mirrored pages (deliberately clamped — see Edit Clamp)

## Architecture

New `mirror` pipeline in `apps/api`, sibling to the existing rebuild pipeline. Same patterns: one HTTP endpoint + one BullMQ worker per stage, artifacts in the `pipelineArtifacts` store, S3 for blobs.

```
URL in → Crawl → Asset Capture → Rewrite → Snapshot vN
                                              │
             Transform list (Postgres) ───────┤
                                              ▼
                                     Deploy (apply transforms) → dist → S3 → CloudFront
```

### Stage 1: Crawl

- Playwright BFS from root URL, same-origin only, 50-page cap. Reuses browser/session management from `src/utils/scrape-website.ts` but is deliberately dumber: rendered post-JS HTML only. No computed-style analysis, no section classification, no vision.
- Also fetches: `sitemap.xml`, `robots.txt`, and probes existing redirects (follow each internal link without auto-redirect; record 301/302 source→target pairs).
- Detects **dynamic content regions** per page (see Dynamic Content) and **native forms** (same-origin `action`).
- Output: `MirrorCrawlArtifact` — page manifest (url, path, title, renderedHtml ref, redirects, forms found, dynamic regions, embeds found, failures).

### Stage 2: Asset capture

- Download same-origin and hotlinked static assets: CSS, JS, images, fonts, favicons, video posters. Parse CSS for `url()` references (fonts, background images) recursively.
- **Third-party `<script>`/`<iframe>` sources are NOT rehosted** (booking widgets, Mindbody, Calendly, analytics — they self-update from their origins). Recorded in manifest as embeds.
- Reuses S3 upload patterns from `src/utils/scraped-assets.ts`. Assets stored under `sites/{siteId}/snapshots/{v}/assets/`.
- Asset download failures: keep the original absolute URL in place, flag in manifest.

### Stage 3: Rewrite

Pure functions over the captured HTML/CSS (unit-testable, no I/O):

1. Rewrite same-origin asset URLs → relative snapshot paths.
2. Rewrite internal links → relative paths (preserving the exact original path structure).
3. Rewrite native form `action` → `POST /forms/{siteId}/{formId}` (formId assigned per discovered form; original action stored).
4. Strip origin-specific analytics? **No** — keep their existing GA/pixel tags. Add nothing here (tracking is injected via transform at deploy).
5. Regenerate `sitemap.xml` (same paths, new absolute host applied at deploy) and `robots.txt`.
6. Emit a `_redirects` map from crawled 301/302 pairs.

### Stage 4: Snapshot store

- Immutable, versioned: `sites/{siteId}/snapshots/{v}/` in S3 + manifest row in `pipelineArtifacts` (stage: `mirror-snapshot`).
- Re-mirroring pre-cutover creates v(N+1). Nothing is ever mutated.
- Keep 3 versions (existing artifact-store behavior).

### Stage 5: Transform layer (the agent's write surface)

New Postgres table `siteTransforms`:

| column | notes |
|---|---|
| uuid, siteUuid, companyId | standard multi-tenant keys |
| ordinal | application order |
| type | `meta-set` \| `jsonld-inject` \| `head-inject` \| `text-replace` \| `attr-set` \| `form-route` \| `page-replace` |
| pageGlob | route pattern, e.g. `/`, `/coaches`, `/*` |
| selector | CSS selector target (null for head-level types) |
| payload | JSONB, type-specific |
| author | `agent` \| `human` |
| status | `active` \| `stale` \| `disabled` |

- **Edit clamp:** these seven types are the ONLY mutations allowed on mirrored routes. No `html-insert`, no free-form HTML editing. Structural change requests are rejected at the API with the message that the page must be ported to a supported template (`page-replace`, phase 2).
- Applied at deploy time over the snapshot (cheerio or similar server-side DOM). A transform whose selector no longer matches is marked `stale` and skipped — never fails the deploy, always surfaced in the deploy report.
- `page-replace` payload: `{ artifactRef }` pointing at a separately stored built page. Phase 1 implements the **resolution** (route serves the replacement artifact instead of snapshot+transforms) but nothing produces these yet.

### Stage 6: Deploy & serve

- Deploy = snapshot vN + active transforms → rendered `dist/` → upload to `sites/{siteId}/deploys/{deployId}/` → CloudFront.
- **CloudFront + Origin Access Control** in front of the S3 bucket. No public ACLs (this also resolves the existing S3-serving open issue for the rebuild pipeline).
- Preview: `{slug}.<preview-domain>` immediately, with `<meta name="robots" content="noindex">` injected on ALL preview deploys (removed on production deploys).
- Production: gym's domain as CloudFront alternate domain name + ACM DNS-validated certificate.

### Form handler

- `POST /forms/{siteId}/{formId}` Fastify route → new `leads` table (siteUuid, companyId, formId, fields JSONB, sourcePath, createdAt) → notify gym by email.
- Spam basics: honeypot field injected into rewritten forms, per-IP rate limit.
- Response: redirect back to the page with a `?submitted=1` param (or honor the form's original success behavior when detectable).

### Cutover flow

State machine on the site: `mirrored → preview_approved → dns_pending → dns_verified → live`.

1. Gym approves preview.
2. Optional final re-crawl (fresh snapshot) before freeze.
3. Generate exact DNS instructions: A/ALIAS for apex + CNAME for `www` **only**. Instructions explicitly enumerate records NOT to touch: **MX, SPF/DKIM/TXT, and any other existing subdomains** (e.g. `members.` pointing at a booking portal). Before generating instructions, fetch and display the current DNS zone (public lookup) so the diff is explicit.
4. Poll DNS until propagated; issue/validate ACM cert; flip CloudFront alias; deploy production (noindex removed).
5. Post-cutover checklist artifact: sitemap submitted, GSC property + GA wiring instructions generated (agent measurement plumbing starts here).

## Dynamic content

The mirror's biggest product risk: frozen schedules and dead blogs.

- Crawl-stage heuristics flag likely dynamic regions: schedule/calendar keywords + table/grid structures, blog index patterns (dated post lists), "powered by" plugin markers.
- Flags land in the manifest as `dynamicRegions` with severity. They do NOT block deploy.
- Surfaced in the preview approval UI as warnings: "This schedule will not update. Replace with a live widget or port this page first."
- Mitigations available in phase 1: `text-replace`/`attr-set` transforms (point a stale schedule at their live booking page), or hold that route back from cutover. Full fix (live widget / structured page) is phase 2 `page-replace`.

## Content model contract (phase-2 interface, defined now)

Phase 2 consumes a template-agnostic content store. Phase 1 does not build it, but the existing docgen output already approximates it and nothing in phase 1 may conflict with it:

- **businessInfo** — existing `business-info` doc shape
- **brandTokens** — colors, fonts, logo, imagery (existing `brand-guidelines` + `design-system-v2`)
- **pageContent** — per route: ordered typed blocks `{ type: hero|offerings|coaches|testimonials|pricing|schedule|faq|cta|richtext, fields }` — derived from existing `site-hierarchy` sections
- A `page-replace` artifact = (templateRef, contentBinding) rendered to static output. Phase 1 only resolves the rendered artifact.

## Error handling

- Page render failures: retry ×2, then record in manifest failures; pipeline proceeds.
- Asset failures: original URL retained, flagged.
- Stale transforms: skipped + flagged, deploy proceeds.
- Cutover: no DNS instructions until preview approved; no production flip until DNS verified and cert issued.
- Crawl blocked (Cloudflare bot protection, auth walls): fail the job with a typed error surfaced to the operator; do not partially mirror.

## Testing & eval

- **Unit:** rewriter functions (URL rewrite, form rewrite, CSS url() parsing), transform applicator (each type + stale handling), redirect map emission.
- **Integration:** form handler route (lead stored, honeypot rejected, rate limit), transform CRUD + clamp rejection of disallowed types.
- **Eval harness** (extends `apps/api/scripts/eval/`): run mirror against real gym URLs, then crawl the DEPLOYED mirror and score against origin:
  - per-page screenshot similarity (pixelmatch, reuse `page-qa.ts`) — target ≥95, expected ~99; below target is a bug, not a tuning problem
  - zero broken asset requests (no 4xx/5xx on same-origin resources)
  - all discovered forms intercepted; embeds load; redirects honored; sitemap paths identical to origin
- **Manual before first customer:** full cutover rehearsal on a domain we own.

## Retired / retargeted from the existing pipeline

- **Retired:** pixel-fidelity self-heal loop, fidelity thresholds/presets for replication, replication-mode LLM section rendering as an onboarding path. Open issues #2–4 from the prior effort (astro check timeouts, section tagging, parallel rendering) are deferred to phase 2.
- **Retargeted:** extract/segment/docgen continue to run (they populate the content model for phase 2); `page-qa.ts` pixelmatch moves to mirror eval where near-identical scores are actually achievable.

## Known risks accepted in phase 1

- Content licensing (stock photos, agency ownership): ToS places content-rights responsibility on the gym; add a basic sanitization pass (strip obviously injected spam/malware script tags flagged by heuristics) — not a full security scan.
- Blogs are frozen: flagged as dynamic content; active bloggers are early candidates for phase-2 page porting.
- Milo becomes a hosting provider: uptime/SSL/support burden accepted; CloudFront + ACM auto-renewal minimizes SSL ops.
- GHL/Grow overlap: positioning question, not a build question; out of scope here.
