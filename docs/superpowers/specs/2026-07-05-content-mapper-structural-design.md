# Structural Content Mapper — Design

**Date:** 2026-07-05
**Status:** Approved for planning

## Goal

Produce a valid `GymSiteContent` (`gym.json`) from the structured pipeline docs stored in the `Docs` table, so a mirrored gym can be upgraded to the Managed (Astro template) tier without manual content authoring.

## Scope (Phase 1 — Structural only)

Deterministic extraction of brand tokens, business info, and navigation from the structured docs. Page content fields that require LLM inference (hero copy, value props, program descriptions, testimonials, FAQ) are populated with safe defaults or left as empty arrays. The result renders a fully styled, real-data template immediately. LLM content enrichment is a separate Phase 2.

## Decisions

| Question | Decision |
|---|---|
| LLM calls | None — deterministic only |
| Trigger | Upgrade flow — called inside `deploy-template.ts` |
| Missing docs | Best-effort with defaults; log warnings array |

---

## Source docs

All read from the `Docs` table (`key` column, `contentJson` or `content`):

| Doc key | Field used | Format |
|---|---|---|
| `design-system` | `contentJson` → `DesignSystemV2` | Structured JSON |
| `business-info` | `content` (markdown) | Plain text, regex extraction |
| `site-hierarchy` | `contentJson` → `SiteHierarchy` | Structured JSON |

`brand-guidelines` is not needed for Phase 1 — its content is duplicated in `design-system`.

---

## File map

| File | Action |
|---|---|
| `apps/api/src/services/template/content-mapper.ts` | **Create** — main mapper |
| `apps/api/src/services/template/deploy-template.ts` | **Modify** — call mapper before writing gym.json |
| `apps/api/src/services/template/__tests__/content-mapper.test.ts` | **Create** — unit tests |

---

## Mapper API

```typescript
export interface MapperResult {
  content: GymSiteContent;
  warnings: string[]; // e.g. "phone not found — using empty string"
}

export async function buildGymJson(
  db: Kysely<DB>,
  siteUuid: string,
  config: { apiBaseUrl: string; siteUrl: string },
): Promise<MapperResult>
```

The function is `async` only because it queries the DB. The transform logic itself is pure and synchronous once docs are loaded.

---

## Field mapping

### `meta: SiteMeta`

| Field | Source | Fallback |
|---|---|---|
| `siteId` | `siteUuid` param | — |
| `apiBaseUrl` | `config.apiBaseUrl` | — |
| `siteUrl` | `config.siteUrl` | — |
| `defaultTitle` | `"{name} \| {geo.city} Gym"` | `business.name` |
| `defaultDescription` | `design-system.business.tagline` | `""` |
| `preview` | always `false` | — |

Tracking IDs (`googleTagManagerId`, etc.) are not mapped — they live in `sites.integrations` and are injected separately.

---

### `brand: BrandTokens`

Source: `design-system.contentJson.global.tokens` (ThemeTokens) and `design-system.contentJson.brand`.

| Field | Source path | Fallback |
|---|---|---|
| `primaryColor` | `global.tokens.colors.primary` | `"#1a1a1a"` |
| `secondaryColor` | `global.tokens.colors.background` | `"#ffffff"` |
| `accentColor` | `global.tokens.colors.muted` | `"#666666"` |
| `headingFont` | `global.tokens.fonts.heading` | `"Inter"` |
| `bodyFont` | `global.tokens.fonts.body` | `"Inter"` |
| `logoUrl` | `brand.logo.value` when `brand.logo.type === "image"` | `""` |
| `logoAlt` | `brand.logo.alt` | `business.name` |

---

### `business: BusinessInfo`

Primary source: `design-system.contentJson.business` and `design-system.contentJson.reference`.
Secondary source: `business-info` markdown (regex extraction for address/phone/hours).

| Field | Source | Fallback |
|---|---|---|
| `name` | `design-system.business.name` or `siteMetadata.businessName` | `""` |
| `tagline` | `design-system.business.tagline` | `""` |
| `primaryCta` | `design-system.reference.homePagePrimaryCta` | `{ label: "Get started", url: "/" }` |
| `phone` | regex `/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/` on business-info markdown | `""` |
| `email` | regex `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/` | `""` |
| `address.street` | regex: line before city/state/zip pattern | `""` |
| `address.city` | regex: city before state abbreviation | `""` |
| `address.state` | regex: full state name or abbreviation | `""` |
| `address.zip` | regex: 5-digit zip | `""` |
| `hours` | regex: day ranges + time ranges (e.g. "Mon–Fri 5am–9pm") | `[]` |
| `geo` | derived from `address.city` / `address.state` | `{ city: "", state: "", stateAbbr: "" }` |
| `aggregateRating` | not mapped in Phase 1 | `undefined` |
| `social` | not mapped in Phase 1 | `undefined` |

State name → abbreviation uses a small lookup table (50 US states).

---

### `navigation: Navigation`

Source: `site-hierarchy.contentJson.pages`.

**Header:** Top-level pages that are not legal/blog pages, mapped to `NavItem[]`:
- `label` ← `page.title`
- `href` ← `"/" + page.slug` (or `"/"` for the home page)
- Pages with path-children in the hierarchy get `children` sub-items

**Footer:** Three fixed groups derived from the page list:
1. "Company" — about, contact pages
2. "Programs" — program-type pages (see classification below)
3. "Legal" — privacy-policy, terms pages

**Announcement:** not mapped in Phase 1.

---

### `pages: PageContent`

Source: `site-hierarchy.contentJson.pages`.

#### Page classification

Each `HierarchyPage` is classified by examining `slug`, `path`, and `pageType`:

| Class | Slug/path patterns |
|---|---|
| home | `isHomePage === true` or slug `""` / `"home"` |
| about | contains `"about"` |
| contact | contains `"contact"` |
| pricing | contains `"pricing"` or `"membership"` or `"join"` |
| schedule | contains `"schedule"` or `"classes"` |
| blog | `pageType === "blog"` or contains `"blog"` |
| legal | contains `"privacy"` or `"terms"` |
| program | everything else that is not home and has `pageType === "interior"` or `"unknown"` |

#### Home page

| Field | Source | Default |
|---|---|---|
| `hero.headline` | hero `HierarchySection.content.heading` | `business.name` |
| `hero.subheading` | hero section `content.body` | `business.tagline` |
| `hero.ctaLabel` | hero section `content.cta.label` | `primaryCta.label` |
| `hero.ctaUrl` | hero section `content.cta.href` | `primaryCta.url` |
| `hero.backgroundImageUrl` | `page.heroImageUrl` | `""` |
| `programsHeadline` | `"Our Programs"` | — |
| `featuredPrograms` | slugs of the first 6 program-class pages | `[]` |
| `valueProps` | `[]` | — |
| `features` | `[]` | — |
| `testimonials` | `[]` | — |
| `faq` | `[]` | — |
| `howItWorks` | `[]` | — |
| `communityHeadline` | `""` | — |
| `communityProps` | `[]` | — |
| `trustHeadline` | `""` | — |

#### Program pages

One `ProgramContent` per classified program page:

| Field | Source | Default |
|---|---|---|
| `slug` | `page.slug` | — |
| `name` | `page.title` | — |
| `shortDescription` | hero section `content.body` (first 160 chars) | `""` |
| `coverImageUrl` | `page.heroImageUrl` | `""` |
| `hero.headline` | hero section `content.heading` | `page.title` |
| `hero.subheading` | hero section `content.body` | `""` |
| `hero.backgroundImageUrl` | `page.heroImageUrl` | `""` |
| `whatIsIt` | `{ headline: "", body: "" }` | — |
| `whatMakesUsDifferent` | `[]` | — |
| `whatToExpect` | `{ headline: "", steps: [] }` | — |
| `whoIsItFor` | `[]` | — |
| `gettingStarted` | `[]` | — |
| `testimonials` | `[]` | — |
| `faq` | `[]` | — |

#### About, contact, pricing, schedule, blog, legal

Each mapped minimally — `hero.headline` from `page.title`, all rich fields empty. `blog.posts = []`.

---

## Integration with `deploy-template.ts`

`deploy-template.ts` currently receives `content: GymSiteContent` from its caller. Change the function to call `buildGymJson` internally:

```typescript
// In deployTemplate(), before the fs.writeFile call:
const { content, warnings } = await buildGymJson(db, siteUuid, {
  apiBaseUrl: config.CDN_BASE_URL,
  siteUrl: site.customDomain
    ? `https://${site.customDomain}`
    : `${config.CDN_BASE_URL}/sites/${siteUuid}/current`,
});
if (warnings.length > 0) {
  log.warn({ siteUuid, warnings }, "content mapper used defaults");
}
```

Remove `content` from `DeployTemplateInput` — callers no longer supply it.

---

## Error handling

- If `design-system` doc is missing: warn + use all brand/business defaults
- If `site-hierarchy` doc is missing: warn + generate minimal single-page structure (home only)
- If regex extraction returns nothing: warn + use empty string / empty array
- Mapper never throws — returns `{ content, warnings }` in all cases

---

## Testing

Unit tests with fixture JSON (no DB):

1. Full extraction — all 3 docs present, assert all non-empty fields populated correctly
2. Brand tokens — known design-system fixture → exact color/font values
3. Business info — known business-info markdown → phone/address/hours extracted
4. Nav generation — hierarchy with 8 pages → correct header/footer grouping
5. Program classification — hierarchy pages classified correctly by slug pattern
6. Missing design-system doc — all brand fields fall back to defaults, warning logged
7. Missing hierarchy doc — minimal home-only structure generated

---

## Out of scope (Phase 2)

- Hero copy, value props, program descriptions, testimonials, FAQ — LLM pass
- Aggregate rating extraction
- Social links extraction
- Blog post import from scraped UGC
- Tracking ID mapping from `sites.integrations`
