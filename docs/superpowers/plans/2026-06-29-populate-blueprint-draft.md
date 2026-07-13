# Populate blueprint-draft from scrape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty `blueprint-draft` placeholder with a real JSON blueprint inferred from scraped website data, including design tokens, global shell (header/footer/nav), a homepage shell, and secondary pages derived from navigation links.

**Architecture:** Add a focused `site-blueprint.ts` builder that reuses the existing `buildTemplateShell` homepage construction and derives design tokens and extra pages from the raw scrape. `site-docs.ts` then renders that blueprint into the `blueprint-draft` markdown doc as a pretty-printed JSON block.

**Tech Stack:** TypeScript, `@milo/shared-types` (`ThemeTokens`, `TemplateShellPage`, `SiteSection`), Vitest.

---

## File map

- `apps/api/src/utils/site-blueprint.ts` — new file. Defines `SiteBlueprint`, `buildSiteBlueprint`, token/page inference helpers.
- `apps/api/src/utils/site-docs.ts` — modify `makeBlueprintDraftDoc` to call `buildSiteBlueprint` and render JSON.
- `apps/api/test/utils/site-blueprint.test.ts` — new tests for the blueprint builder.
- `apps/api/test/utils/site-docs.test.ts` — add assertions that the generated `blueprint-draft` doc is populated.

---

## Task 1: Create the blueprint builder

**Files:**
- Create: `apps/api/src/utils/site-blueprint.ts`
- Test: `apps/api/test/utils/site-blueprint.test.ts`

### Step 1: Write the failing test

Create `apps/api/test/utils/site-blueprint.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { buildSiteBlueprint } from "../../src/utils/site-blueprint";
import type { ScrapedWebsiteData } from "../../src/utils/scrape-docs";

const baseScrape: ScrapedWebsiteData = {
  url: "https://example-gym.com",
  title: "Beta Gym - Functional Fitness",
  description: "A community gym for functional fitness.",
  businessName: "Beta Gym",
  tagline: "Stronger together.",
  headings: ["Train with purpose", "Join today", "Our coaches"],
  paragraphs: ["We build fitness for real life.", "Group classes for every level."],
  buttons: ["Book a class", "Start free trial"],
  navLinks: [
    { label: "Classes", href: "/classes" },
    { label: "Coaches", href: "/coaches" },
    { label: "About", href: "/about" },
  ],
  colors: [
    { token: "primary", hex: "#111111", role: "text", usage: "headings" },
    { token: "accent", hex: "#ff4d00", role: "accent", usage: "CTAs" },
    { token: "background", hex: "#ffffff", role: "background", usage: "canvas" },
  ],
  fonts: [{ family: "Inter", role: "body", weights: [400, 700] }],
  fontSizes: [{ element: "h1", desktop: "48px", mobile: "32px" }],
  images: [{ url: "https://example-gym.com/hero.jpg", context: "hero", promptKeywords: ["athletes", "gym"], alt: "Athletes training" }],
  layoutRules: [{ element: "section", value: "max-width 1200px, padding 80px vertical" }],
  faqs: [{ question: "Do you offer drop-ins?", answer: "Yes, $25 per class." }],
  testimonials: [{ quote: "Best gym in town.", author: "Jane D.", role: "Member" }],
  locations: [{ name: "Downtown", address: "123 Main St" }],
  team: [{ name: "Coach Alex", role: "Head coach", bio: "CSCS certified." }],
  offerings: [{ name: "Group class", description: "One hour", price: "$30" }],
  contact: { phone: "555-1234", email: "hi@example-gym.com", social: [] },
  screenshotUrls: ["https://example-gym.com/screenshot.png"],
};

describe("buildSiteBlueprint", () => {
  test("populates site metadata from scrape", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.site_metadata.target_url).toBe("https://example-gym.com");
    expect(bp.site_metadata.framework).toBe("astro");
    expect(bp.site_metadata.mode).toBe("replication");
    expect(bp.site_metadata.business_name).toBe("Beta Gym");
    expect(bp.site_metadata.generated_at).toMatch(/^\d{4}-/);
  });

  test("derives design tokens from scraped colors and fonts", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.design_tokens.colors.primary).toBe("#ff4d00");
    expect(bp.design_tokens.colors.background).toBe("#ffffff");
    expect(bp.design_tokens.fonts.body).toBe("Inter");
    expect(bp.design_tokens.radius).toBe("0.5rem");
  });

  test("extracts global header and footer from homepage shell", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.global_shell.header?.type).toBe("SiteHeader");
    expect(bp.global_shell.footer?.type).toBe("SiteFooter");
    expect(bp.global_shell.navLinks).toEqual(baseScrape.navLinks);
    expect(bp.global_shell.theme).toEqual(bp.design_tokens);
  });

  test("homepage uses body sections without duplicating global header/footer", () => {
    const bp = buildSiteBlueprint(baseScrape);
    const home = bp.pages.find((p) => p.isHomePage)!;
    expect(home.slug).toBe("index");
    const types = home.sections.map((s) => s.type);
    expect(types).toContain("Hero");
    expect(types).not.toContain("SiteHeader");
    expect(types).not.toContain("SiteFooter");
  });

  test("infers secondary pages from nav links", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.pages.find((p) => p.slug === "classes")).toBeDefined();
    expect(bp.pages.find((p) => p.slug === "coaches")).toBeDefined();
    expect(bp.pages.find((p) => p.slug === "about")).toBeDefined();

    const classes = bp.pages.find((p) => p.slug === "classes")!;
    expect(classes.sections.some((s) => s.type === "SiteCardGroup")).toBe(true);

    const about = bp.pages.find((p) => p.slug === "about")!;
    expect(about.sections.some((s) => s.type === "Text")).toBe(true);
  });

  test("falls back to neutral tokens when scrape lacks brand data", () => {
    const minimal: ScrapedWebsiteData = {
      ...baseScrape,
      colors: [],
      fonts: [],
      designTokens: [],
    };
    const bp = buildSiteBlueprint(minimal);
    expect(bp.design_tokens.colors.primary).toBe("#111111");
    expect(bp.design_tokens.colors.background).toBe("#ffffff");
    expect(bp.design_tokens.fonts.heading).toBe("Sans-serif");
    expect(bp.design_tokens.fonts.body).toBe("Sans-serif");
  });
});
```

### Step 2: Run the test to verify it fails

```bash
pnpm exec vitest run --no-file-parallelism apps/api/test/utils/site-blueprint.test.ts
```

Expected: FAIL — `buildSiteBlueprint` is not defined / module not found.

### Step 3: Implement the blueprint builder

Create `apps/api/src/utils/site-blueprint.ts`:

```typescript
import type { ScrapedWebsiteData } from "./scrape-docs";
import type {
  SiteSection,
  TemplateShellPage,
  ThemeTokens,
} from "@milo/shared-types";
import { buildTemplateShell } from "./template-shell";

const NEUTRAL_TOKENS: ThemeTokens = {
  colors: {
    primary: "#111111",
    primaryForeground: "#ffffff",
    background: "#ffffff",
    foreground: "#171717",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    border: "#e5e5e5",
  },
  fonts: {
    heading: "Sans-serif",
    body: "Sans-serif",
  },
  radius: "0.5rem",
};

export interface SiteBlueprint {
  site_metadata: {
    framework: "astro";
    mode: "replication";
    target_url: string;
    business_name?: string;
    generated_at: string;
  };
  design_tokens: ThemeTokens;
  global_shell: {
    theme: ThemeTokens;
    header?: SiteSection;
    footer?: SiteSection;
    navLinks: { label: string; href: string }[];
  };
  pages: TemplateShellPage[];
}

function buildDesignTokens(data: ScrapedWebsiteData): ThemeTokens {
  const text = data.colors.find((c) => c.role === "text")?.hex;
  const bg = data.colors.find((c) => c.role === "background")?.hex;
  const accent = data.colors.find((c) => c.role === "accent")?.hex;
  const muted = data.colors.find((c) => c.role === "textMuted")?.hex;
  const border = data.colors.find((c) => c.role === "border")?.hex;
  const headingFont = data.fonts.find((f) => f.role === "heading")?.family;
  const bodyFont = data.fonts.find((f) => f.role === "body")?.family;
  const radius =
    data.designTokens?.find((t) => t.category === "radius")?.value ??
    NEUTRAL_TOKENS.radius;

  return {
    colors: {
      primary: accent ?? text ?? NEUTRAL_TOKENS.colors.primary,
      primaryForeground: bg ?? NEUTRAL_TOKENS.colors.primaryForeground,
      background: bg ?? NEUTRAL_TOKENS.colors.background,
      foreground: text ?? NEUTRAL_TOKENS.colors.foreground,
      muted: muted ?? NEUTRAL_TOKENS.colors.muted,
      mutedForeground: muted ?? NEUTRAL_TOKENS.colors.mutedForeground,
      border: border ?? NEUTRAL_TOKENS.colors.border,
    },
    fonts: {
      heading: headingFont ?? NEUTRAL_TOKENS.fonts.heading,
      body: bodyFont ?? NEUTRAL_TOKENS.fonts.body,
    },
    radius,
  };
}

function deriveSlug(href: string, fallback: string): string {
  try {
    if (href.startsWith("/")) {
      const slug = href.replace(/^\/+/, "").split("/")[0];
      if (slug) return slug;
    }
    const url = new URL(href);
    const slug = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (slug) return slug;
  } catch {
    // fall through to fallback
  }
  return (
    fallback.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "page"
  );
}

function makeTextSection(
  title: string,
  body: string,
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "Text",
    props: { title, body, align: "center" },
  };
}

function makeCardGroupSection(
  title: string,
  items: { title?: string; description?: string }[],
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteCardGroup",
    props: {
      title,
      layout: items.length >= 3 ? "grid" : "row",
      cards: items.map((item) => ({
        title: item.title,
        description: item.description,
      })),
    },
  };
}

function makeReviewsSection(
  testimonials: { quote: string; author?: string; role?: string }[],
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteReviews",
    props: {
      title: "What members say",
      reviews: testimonials.map((t) => ({
        quote: t.quote,
        author: [t.author, t.role].filter(Boolean).join(", "),
      })),
    },
  };
}

function makeLocationSection(
  locations: { name?: string; address?: string }[],
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteLocation",
    props: {
      title: "Visit us",
      address: locations
        .map((loc) => [loc.name, loc.address].filter(Boolean).join(" — "))
        .join("\n"),
      hours: "",
      phone: "",
      mapLink: "#map",
    },
  };
}

function inferSecondaryPage(
  link: { label: string; href: string },
  data: ScrapedWebsiteData,
): TemplateShellPage {
  const slug = deriveSlug(link.href, link.label);
  const title = link.label;
  const label = link.label.toLowerCase();
  const sections: SiteSection[] = [];
  const sectionId = (prefix: string) => `${slug}-${prefix}`;

  if (
    label.includes("class") ||
    label.includes("service") ||
    label.includes("program") ||
    label.includes("membership") ||
    label.includes("pricing")
  ) {
    if (data.offerings.length > 0) {
      sections.push(
        makeCardGroupSection(title, data.offerings, sectionId("offerings")),
      );
    }
  } else if (
    label.includes("coach") ||
    label.includes("team") ||
    label.includes("trainer") ||
    label.includes("staff")
  ) {
    if (data.team.length > 0) {
      sections.push(
        makeCardGroupSection(
          title,
          data.team.map((member) => ({
            title: member.name,
            description: member.bio,
          })),
          sectionId("team"),
        ),
      );
    }
  } else if (
    label.includes("about") ||
    label.includes("story") ||
    label.includes("mission")
  ) {
    const body =
      data.description ||
      data.paragraphs.slice(0, 2).join("\n\n") ||
      "";
    if (body) {
      sections.push(makeTextSection(title, body, sectionId("about")));
    }
  } else if (
    label.includes("contact") ||
    label.includes("location") ||
    label.includes("visit") ||
    label.includes("find us")
  ) {
    if (data.locations.length > 0) {
      sections.push(makeLocationSection(data.locations, sectionId("location")));
    }
  } else if (
    label.includes("testimonial") ||
    label.includes("review") ||
    label.includes("result")
  ) {
    if (data.testimonials.length > 0) {
      sections.push(makeReviewsSection(data.testimonials, sectionId("reviews")));
    }
  }

  if (sections.length === 0) {
    const body = data.description || data.paragraphs[0] || "";
    if (body) {
      sections.push(makeTextSection(title, body, sectionId("content")));
    }
  }

  return {
    slug,
    title,
    isHomePage: false,
    metaTitle: title,
    sections,
  };
}

export function buildSiteBlueprint(data: ScrapedWebsiteData): SiteBlueprint {
  const tokens = buildDesignTokens(data);
  const homeShell = buildTemplateShell(data);
  const header = homeShell.page.sections.find((s) => s.type === "SiteHeader");
  const footer = homeShell.page.sections.find((s) => s.type === "SiteFooter");

  const homePage: TemplateShellPage = {
    ...homeShell.page,
    sections: homeShell.page.sections.filter(
      (s) => s.type !== "SiteHeader" && s.type !== "SiteFooter",
    ),
  };

  const secondaryPages = data.navLinks
    .filter(
      (link) =>
        !link.href.startsWith("http") &&
        !link.href.startsWith("#") &&
        link.href !== "/",
    )
    .map((link) => inferSecondaryPage(link, data));

  return {
    site_metadata: {
      framework: "astro",
      mode: "replication",
      target_url: data.url,
      business_name: data.businessName,
      generated_at: new Date().toISOString(),
    },
    design_tokens: tokens,
    global_shell: {
      theme: tokens,
      header,
      footer,
      navLinks: data.navLinks,
    },
    pages: [homePage, ...secondaryPages],
  };
}
```

### Step 4: Run the test to verify it passes

```bash
pnpm exec vitest run --no-file-parallelism apps/api/test/utils/site-blueprint.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/api/src/utils/site-blueprint.ts apps/api/test/utils/site-blueprint.test.ts
git commit -m "feat: build site blueprint from scraped data"
```

---

## Task 2: Wire the blueprint into the generated doc

**Files:**
- Modify: `apps/api/src/utils/site-docs.ts` (import + `makeBlueprintDraftDoc`)

### Step 1: Write the failing test update

Append to `apps/api/test/utils/site-docs.test.ts` inside the `describe("generateSiteDocs", ...)` block:

```typescript
  test("blueprint draft doc contains a populated site blueprint, not an empty placeholder", () => {
    const docs = generateSiteDocs(baseScrape);
    const blueprint = docs.find((d) => d.key === "blueprint-draft")!;
    expect(blueprint.content).toContain("## Site blueprint");
    expect(blueprint.content).toContain('"site_metadata"');
    expect(blueprint.content).toContain('"target_url": "https://example-gym.com"');
    expect(blueprint.content).toContain('"pages"');
    expect(blueprint.content).toContain('"slug": "index"');
    expect(blueprint.content).toContain('"slug": "classes"');
    expect(blueprint.content).not.toContain('"design_tokens": {}');
    expect(blueprint.content).not.toContain('"pages": []');
  });
```

### Step 2: Run the updated test to verify it fails

```bash
pnpm exec vitest run --no-file-parallelism apps/api/test/utils/site-docs.test.ts -t "blueprint draft"
```

Expected: FAIL — the blueprint doc still contains the old placeholder JSON.

### Step 3: Update `makeBlueprintDraftDoc`

At the top of `apps/api/src/utils/site-docs.ts`, add the import:

```typescript
import { buildSiteBlueprint } from "./site-blueprint";
```

Replace the existing `makeBlueprintDraftDoc` function with:

```typescript
function makeBlueprintDraftDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const blueprint = buildSiteBlueprint(ctx.scraped);
  return {
    key: "blueprint-draft",
    title: "Blueprint draft",
    content: `# Blueprint draft

This doc holds the initial JSON blueprint derived from the scraped source site.

## Site blueprint

\`\`\`json
${JSON.stringify(blueprint, null, 2)}
\`\`\`
`,
    source: "ai_extracted",
  };
}
```

### Step 4: Run the updated test to verify it passes

```bash
pnpm exec vitest run --no-file-parallelism apps/api/test/utils/site-docs.test.ts -t "blueprint draft"
```

Expected: PASS.

### Step 5: Run the broader doc test suite

```bash
pnpm exec vitest run --no-file-parallelism apps/api/test/utils/site-docs.test.ts apps/api/test/utils/site-blueprint.test.ts
```

Expected: all PASS.

### Step 6: Commit

```bash
git add apps/api/src/utils/site-docs.ts apps/api/test/utils/site-docs.test.ts
git commit -m "feat: render populated blueprint in blueprint-draft doc"
```

---

## Task 3: Verify typecheck, lint, and full tests

### Step 1: Typecheck the API package

```bash
cd apps/api && pnpm build
```

Expected: no TypeScript errors.

### Step 2: Lint the API package

```bash
cd apps/api && pnpm lint
```

Expected: no lint errors.

### Step 3: Run the full API test suite

```bash
cd apps/api && pnpm test
```

Expected: all tests PASS. Note this runs migrations against the test database first via the `pretest` script.

### Step 4: Commit any fixes

If typecheck/lint/tests reveal issues, fix them and commit:

```bash
git add <changed-files>
git commit -m "fix: resolve blueprint type/lint/test issues"
```

---

## Self-review checklist

1. **Spec coverage:**
   - Replace empty `blueprint-draft` placeholder ✓ (Task 2)
   - Derive pages from scrape ✓ (Task 1 homepage + secondary page inference)
   - Include design tokens ✓ (Task 1)
   - Include global shell ✓ (Task 1)
2. **Placeholder scan:** No TBD/TODO/fill-in-later code. Every step shows concrete code/commands.
3. **Type consistency:** `SiteBlueprint` uses `ThemeTokens` and `TemplateShellPage` from shared types. `buildSiteBlueprint` accepts `ScrapedWebsiteData` and returns `SiteBlueprint`, matching the shape rendered in `makeBlueprintDraftDoc`.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-29-populate-blueprint-draft.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
