# Phase 2 Content Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `content` milo stage that reads each mirrored page's HTML from S3, parses it with cheerio, and uses an LLM to extract structured page content (hero copy, value props, testimonials, programs, contact info, etc.) — populating the fields that the structural content mapper leaves empty.

**Architecture:** The `content` stage reads HTML from `sites/{uuid}/current/` in S3 (already captured by the mirror pipeline), strips chrome with cheerio, makes one LLM call per page to extract page-type-specific JSON, and stores a `content-extraction` pipeline artifact. `buildGymJson` reads this artifact and merges the LLM-extracted content into `GymSiteContent`, falling back to structural defaults when the artifact is absent.

**Tech Stack:** TypeScript · `@aws-sdk/client-s3` · cheerio · `chatCompletion` from `src/ai/llm-client` · Kysely

---

## Context for implementers

- Working directory: `/Users/dan/pushpress/websites`
- S3 bucket: `config.S3_ASSETS_BUCKET` (via `ctx.config`)
- Mirror pages live at: `sites/{siteUuid}/current/{pathToFileKey(pagePath)}`
- `pathToFileKey` is exported from `src/services/mirror/snapshot.ts`
- `chatCompletion(options, config)` is in `src/ai/llm-client.ts`
- `loadArtifact` / `saveArtifact` are in `src/utils/pipeline/artifact-store.ts`
- `GymSiteContent` types are in `@ploy-gyms/shared-types` (gym-content.ts)
- Cheerio usage pattern: `import * as cheerio from "cheerio"` then `const $ = cheerio.load(html)`
- The `content` stage is registered in `apps/api/scripts/milo.ts` via the lazy registry

---

## File map

| File | Action | Purpose |
|---|---|---|
| `apps/api/scripts/stages/content.ts` | **Create** | The `content` milo stage — S3 reader, cheerio parser, LLM extractor, artifact store |
| `apps/api/src/services/template/content-mapper.ts` | **Modify** | `buildGymJson` reads `content-extraction` artifact and merges LLM content |
| `apps/api/scripts/milo.ts` | **Modify** | Register `content` stage in the lazy registry |

---

## Task 1: `content` milo stage

**Files:**
- Create: `apps/api/scripts/stages/content.ts`

- [ ] **Step 1: Create `apps/api/scripts/stages/content.ts`**

```typescript
// apps/api/scripts/stages/content.ts
import * as cheerio from "cheerio";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { chatCompletion } from "../../src/ai/llm-client";
import { saveArtifact, loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { pathToFileKey } from "../../src/services/mirror/snapshot";
import type { StageRunner, StageContext, StageResult } from "./types";

// Max pages to process — skip UGC (blog posts) and cap total
const MAX_CONTENT_PAGES = 20;

// Classify page path into a type
function classifyPageType(path: string): "home" | "program" | "about" | "contact" | "pricing" | "schedule" | "other" {
  if (path === "/" || path === "") return "home";
  const s = path.toLowerCase();
  if (/\/programs\/|\/classes\/|\/crossfit|\/bootcamp|\/training/.test(s)) return "program";
  if (/\/about/.test(s)) return "about";
  if (/\/contact/.test(s)) return "contact";
  if (/\/pricing|\/membership|\/rates/.test(s)) return "pricing";
  if (/\/schedule/.test(s)) return "schedule";
  return "other";
}

// Strip chrome from HTML and return clean body text
function extractBodyText(html: string): string {
  const $ = cheerio.load(html);
  // Remove non-content elements
  $("script, style, noscript, iframe, nav, header, footer, [aria-hidden='true']").remove();
  $("[class*='nav'], [class*='header'], [class*='footer'], [class*='cookie'], [class*='popup']").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.slice(0, 8000);
}

// LLM prompts per page type
function buildPrompt(pageType: string, text: string, path: string): string {
  const base = `Extract structured content from this gym website page. Return ONLY valid JSON. Use null for fields not found.\n\nPage path: ${path}\nPage text:\n${text}\n\n`;

  const schemas: Record<string, string> = {
    home: `Return JSON:\n{"heroHeadline":string|null,"heroSubheading":string|null,"heroCtaLabel":string|null,"valueProps":[{"headline":string,"body":string}],"testimonials":[{"quote":string,"name":string,"program":string|null}],"faq":[{"question":string,"answer":string}],"communityHeadline":string|null,"trustHeadline":string|null}`,
    program: `Return JSON:\n{"name":string|null,"shortDescription":string|null,"heroHeadline":string|null,"heroSubheading":string|null,"whoIsItFor":[string],"whatMakesUsDifferent":[string],"testimonials":[{"quote":string,"name":string}],"faq":[{"question":string,"answer":string}]}`,
    about: `Return JSON:\n{"heroHeadline":string|null,"gymStory":string|null,"team":[{"name":string,"title":string,"bio":string|null}]}`,
    contact: `Return JSON:\n{"heroHeadline":string|null,"phone":string|null,"email":string|null,"address":string|null,"city":string|null,"state":string|null,"zip":string|null,"hours":string|null}`,
    pricing: `Return JSON:\n{"heroHeadline":string|null,"plans":[{"name":string,"price":string,"period":string|null,"description":string|null,"features":[string]}]}`,
    schedule: `Return JSON:\n{"heroHeadline":string|null,"note":string|null}`,
    other: `Return JSON:\n{"heroHeadline":string|null,"summary":string|null}`,
  };

  return base + (schemas[pageType] ?? schemas.other);
}

export interface PageContentExtraction {
  path: string;
  pageType: string;
  data: Record<string, unknown>;
}

export interface ContentExtractionArtifact {
  siteUuid: string;
  extractedAt: string;
  pages: PageContentExtraction[];
}

export const contentStage: StageRunner = {
  label: "content",
  requires: ["mirror-deploy"],
  produces: "content-extraction",

  async run(ctx: StageContext): Promise<StageResult> {
    const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;

    // Load crawl artifact for page list
    const crawlArtifact = await loadArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "mirror-crawl" as any,
    ) as any;

    const allPages: Array<{ path: string }> = crawlArtifact?.payload?.pages ?? [];

    // Filter: skip UGC paths, cap at MAX_CONTENT_PAGES
    const structuralPages = allPages.filter((p) => {
      const s = p.path.toLowerCase();
      return !/\/blog\/|\/recipe|\/news\/|\/post\//.test(s);
    }).slice(0, MAX_CONTENT_PAGES);

    ctx.log(`  Processing ${structuralPages.length} pages (skipped ${allPages.length - structuralPages.length} UGC)`);

    const results: PageContentExtraction[] = [];
    let successCount = 0;
    const warnings: string[] = [];

    for (const page of structuralPages) {
      const pageType = classifyPageType(page.path);
      const s3Key = `sites/${ctx.siteUuid}/current/${pathToFileKey(page.path)}`;

      try {
        // Read HTML from S3 mirror
        const obj = await ctx.s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
        const html = await obj.Body?.transformToString() ?? "";
        if (!html) { warnings.push(`${page.path}: empty HTML`); continue; }

        // Parse and extract clean text
        const text = extractBodyText(html);
        if (!text || text.length < 50) { warnings.push(`${page.path}: no text content`); continue; }

        // LLM extraction
        const prompt = buildPrompt(pageType, text, page.path);
        const response = await chatCompletion({
          model: ctx.config.DEFAULT_LLM_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
        }, ctx.config);

        const raw = response.content ?? "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { warnings.push(`${page.path}: LLM returned no JSON`); continue; }

        const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        results.push({ path: page.path, pageType, data });
        successCount++;
        ctx.log(`  [${pageType}] ${page.path} ✓`);
      } catch (err) {
        warnings.push(`${page.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const artifact: ContentExtractionArtifact = {
      siteUuid: ctx.siteUuid,
      extractedAt: new Date().toISOString(),
      pages: results,
    };

    await saveArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "content-extraction" as any,
      artifact,
    );

    return {
      stage: "content",
      status: warnings.length > 0 ? "warn" : "pass",
      durationMs: 0,
      metrics: { pages: successCount, skipped: structuralPages.length - successCount },
      warnings,
    };
  },
};
```

- [ ] **Step 2: Register in `apps/api/scripts/milo.ts`**

Find the `stageModules` array and add:
```typescript
    ["content", "./stages/content.js"],
```
after `["docgen", "./stages/docgen.js"]`.

- [ ] **Step 3: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 4: Smoke test that the stage loads**

```bash
pnpm milo --url https://fake.com --stages content 2>&1 | head -5
```

Expected: reaches DB connection (confirms module loads, stage is registered).

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/stages/content.ts apps/api/scripts/milo.ts
git commit -m "feat(content): content extraction stage — reads S3 mirror HTML, cheerio parse, LLM per page"
```

---

## Task 2: `buildGymJson` consumes content-extraction artifact

**Files:**
- Modify: `apps/api/src/services/template/content-mapper.ts`

The `buildGymJson` function already loads 3 docs (design-system, business-info, site-hierarchy). After extracting the structural fields, load the `content-extraction` artifact and merge LLM-extracted content.

- [ ] **Step 1: Add `loadArtifact` import and content merging to `buildGymJson`**

Read `apps/api/src/services/template/content-mapper.ts`. Find the `buildGymJson` function. After the existing `extractPages(hierarchy, business, warnings)` call, add:

```typescript
  // Load LLM-extracted content artifact (produced by `content` milo stage)
  const contentArtifact = await loadArtifact(
    db,
    { siteUuid, workspaceUuid: "" },
    "content-extraction" as any,
  ) as { payload: { pages: Array<{ path: string; pageType: string; data: Record<string, unknown> }> } } | null;

  if (contentArtifact?.payload?.pages) {
    const byPath = new Map(contentArtifact.payload.pages.map(p => [p.path, p]));

    // Merge home content
    const homeExtraction = byPath.get("/")?.data as any;
    if (homeExtraction) {
      if (homeExtraction.heroHeadline) pages.home.hero.headline = homeExtraction.heroHeadline;
      if (homeExtraction.heroSubheading) pages.home.hero.subheading = homeExtraction.heroSubheading;
      if (homeExtraction.heroCtaLabel) pages.home.hero.ctaLabel = homeExtraction.heroCtaLabel;
      if (homeExtraction.valueProps?.length) pages.home.valueProps = homeExtraction.valueProps.map((v: any) => ({ icon: "", headline: v.headline ?? "", body: v.body ?? "" }));
      if (homeExtraction.testimonials?.length) pages.home.testimonials = homeExtraction.testimonials.map((t: any) => ({ quote: t.quote ?? "", name: t.name ?? "", program: t.program }));
      if (homeExtraction.faq?.length) pages.home.faq = homeExtraction.faq;
      if (homeExtraction.communityHeadline) pages.home.communityHeadline = homeExtraction.communityHeadline;
      if (homeExtraction.trustHeadline) pages.home.trustHeadline = homeExtraction.trustHeadline;
    }

    // Merge program content
    for (const program of pages.programs) {
      const programPage = byPath.get(`/programs/${program.slug}`)?.data as any;
      if (!programPage) continue;
      if (programPage.shortDescription) program.shortDescription = programPage.shortDescription;
      if (programPage.heroHeadline) program.hero.headline = programPage.heroHeadline;
      if (programPage.heroSubheading) program.hero.subheading = programPage.heroSubheading;
      if (programPage.whoIsItFor?.length) program.whoIsItFor = programPage.whoIsItFor;
      if (programPage.whatMakesUsDifferent?.length) program.whatMakesUsDifferent = programPage.whatMakesUsDifferent;
      if (programPage.testimonials?.length) program.testimonials = programPage.testimonials.map((t: any) => ({ quote: t.quote ?? "", name: t.name ?? "" }));
      if (programPage.faq?.length) program.faq = programPage.faq;
    }

    // Merge about content
    const aboutExtraction = [...byPath.values()].find(p => p.pageType === "about")?.data as any;
    if (aboutExtraction) {
      if (aboutExtraction.heroHeadline) pages.about.hero.headline = aboutExtraction.heroHeadline;
      if (aboutExtraction.gymStory) pages.about.gymStory = aboutExtraction.gymStory;
      if (aboutExtraction.team?.length) pages.about.team = aboutExtraction.team.map((m: any) => ({ name: m.name ?? "", title: m.title ?? "", photoUrl: "", bio: m.bio }));
    }

    // Merge contact info into business
    const contactExtraction = [...byPath.values()].find(p => p.pageType === "contact")?.data as any;
    if (contactExtraction) {
      if (contactExtraction.phone && !business.phone) business.phone = contactExtraction.phone;
      if (contactExtraction.email && !business.email) business.email = contactExtraction.email;
      if (contactExtraction.address && !business.address.street) {
        business.address.street = contactExtraction.address ?? "";
        business.address.city = contactExtraction.city ?? business.address.city;
        business.address.state = contactExtraction.state ?? business.address.state;
        business.address.zip = contactExtraction.zip ?? business.address.zip;
        business.geo.city = contactExtraction.city ?? business.geo.city;
        business.geo.stateAbbr = contactExtraction.state ?? business.geo.stateAbbr;
      }
    }

    // Merge pricing
    const pricingExtraction = [...byPath.values()].find(p => p.pageType === "pricing")?.data as any;
    if (pricingExtraction?.plans?.length) {
      pages.pricing.grid = {
        headline: pricingExtraction.heroHeadline ?? undefined,
        plans: pricingExtraction.plans.map((plan: any) => ({
          name: plan.name ?? "",
          price: plan.price ?? "",
          period: plan.period ?? undefined,
          description: plan.description ?? undefined,
          features: plan.features ?? [],
          cta: { label: "Get started", url: "/contact" },
        })),
      };
    }

    warnings.push(`content-extraction merged: ${contentArtifact.payload.pages.length} pages`);
  }
```

Place this block AFTER `const pages = extractPages(hierarchy, business, warnings);` and BEFORE the `const meta: SiteMeta = {...}` block.

Also add the `loadArtifact` import at the top of the file:
```typescript
import { loadArtifact } from "../../utils/pipeline/artifact-store";
```

And update the `buildGymJson` signature to accept `workspaceUuid`:
```typescript
export async function buildGymJson(
  db: Kysely<DB>,
  siteUuid: string,
  config: MapperConfig,
  workspaceUuid?: string,
): Promise<MapperResult>
```

Update the `loadArtifact` call to use `workspaceUuid ?? ""`.

- [ ] **Step 2: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/template/content-mapper.ts
git commit -m "feat(mapper): merge LLM content-extraction artifact into gym.json — hero, programs, about, contact, pricing"
```

---

## Task 3: Pass workspaceUuid through deploy-template.ts

**Files:**
- Modify: `apps/api/src/services/template/deploy-template.ts`

`buildGymJson` now accepts an optional `workspaceUuid` to look up the content-extraction artifact. Pass it from `deployTemplate`.

- [ ] **Step 1: Update `deployTemplate` to pass `workspaceUuid` to `buildGymJson`**

Read `apps/api/src/services/template/deploy-template.ts`. Find the `buildGymJson` call (it's in the section where `input.content` is absent). Change:

```typescript
const { content: mapped, warnings } = await buildGymJson(db, siteUuid, { apiBaseUrl, siteUrl });
```

To:

```typescript
const { content: mapped, warnings } = await buildGymJson(db, siteUuid, { apiBaseUrl, siteUrl }, workspaceUuid);
```

- [ ] **Step 2: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

- [ ] **Step 3: End-to-end test**

```bash
# Run content extraction on Torrance
pnpm milo --site ab867633-9d48-4258-b752-07214d6314b7 --stages content

# Then build template
pnpm milo --site ab867633-9d48-4258-b752-07214d6314b7 --stages template

# Check preview URL
echo "Preview: https://ab867633-preview.mygymseo.com"
```

Expected: template builds with real hero copy, program descriptions, contact info.

- [ ] **Step 4: Commit + push**

```bash
git add apps/api/src/services/template/deploy-template.ts
git commit -m "feat(mapper): pass workspaceUuid to buildGymJson for content-extraction artifact lookup"
git push origin main
```
