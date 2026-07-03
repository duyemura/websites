import { describe, expect, it, beforeEach, vi } from "vitest";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import { runDocgenStage } from "../../src/services/pipeline/docgen-stage";
import {
  saveArtifact,
  type ArtifactContext,
} from "../../src/utils/pipeline/artifact-store";
import { ConfigSchema, type Config } from "../../src/plugins/env";
import type {
  ExtractArtifact,
  SegmentArtifact,
} from "../../src/types/pipeline-artifacts";

// Mock chatCompletion so any vision-classification calls resolve deterministically.
// The interaction-classifier is the only vision path; workspace-memory extraction
// is guarded on presence of a WorkspaceMemoryContext (we don't pass one), so it
// stays on the heuristic path.
vi.mock("../../src/ai/llm-client", async () => {
  return {
    chatCompletion: vi.fn(async () => ({ content: "dropdown" })),
    LlmClientError: class LlmClientError extends Error {},
    sanitizeRawResponse: (r: unknown) => r,
  };
});

async function seedSite(name = "Docgen Test"): Promise<ArtifactContext> {
  const { workspace } = await setupTestContext();
  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid: workspace.uuid,
      name,
      slug: `docgen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, workspaceUuid: workspace.uuid };
}

function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

function stubExtract(overrides: Partial<ExtractArtifact> = {}): ExtractArtifact {
  const now = "2026-07-03T00:00:00.000Z";
  return {
    url: "https://example.com",
    extractedAt: now,
    siteMap: [
      {
        url: "https://example.com/",
        path: "/",
        title: "Home",
        classification: "structural",
        source: "sitemap",
        status: "captured",
      },
      {
        url: "https://example.com/about",
        path: "/about",
        title: "About",
        classification: "structural",
        source: "nav",
        status: "captured",
      },
    ],
    css: {
      tokens: { "--brand": "#E63946" },
      breakpoints: ["(min-width: 768px)"],
      animations: [],
    },
    pages: [
      {
        path: "/",
        media: [],
        screenshots: {
          full1440: "https://cdn/1440-home.png",
          vp768: "https://cdn/768-home.png",
          vp375: "https://cdn/375-home.png",
        },
        content: {
          title: "Example Home",
          businessName: "Example Gym",
          headings: [
            { level: 1, text: "Welcome to Example" },
            { level: 2, text: "Our classes" },
          ],
          navLinks: [{ label: "About", href: "/about" }],
          meta: {
            "og:title": "Example Gym",
            description: "A friendly gym.",
          },
          jsonLd: [{ "@type": "LocalBusiness", name: "Example Gym" }],
          iframes: [],
          videos: [],
        },
        interactions: [],
        responsive: [
          {
            selector: ".hero",
            property: "font-size",
            at1440: "48px",
            at375: "28px",
          },
        ],
        pixelSamples: [],
        flags: { needsVisionSegmentation: false, isSpa: false },
      },
      {
        path: "/about",
        media: [],
        screenshots: {
          full1440: "https://cdn/1440-about.png",
          vp768: "https://cdn/768-about.png",
          vp375: "https://cdn/375-about.png",
        },
        content: {
          title: "About Example",
          headings: [{ level: 1, text: "About us" }],
          navLinks: [],
          meta: {},
          jsonLd: [],
          iframes: [],
          videos: [],
        },
        interactions: [],
        responsive: [],
        pixelSamples: [],
        flags: { needsVisionSegmentation: false, isSpa: false },
      },
    ],
    sourceBaseline: {
      capturedAt: now,
      lighthouse: [
        {
          path: "/",
          preset: "mobile",
          performance: 82,
          seo: 95,
          accessibility: 90,
          bestPractices: 88,
        },
      ],
      axe: [{ path: "/", violations: [] }],
      network: [
        { path: "/", totalBytes: 100, requestCount: 5, imageBytes: 20 },
      ],
    },
    usage: { pagesCaptured: 2, screenshotCount: 6 },
    ...overrides,
  };
}

function stubSegment(): SegmentArtifact {
  return {
    siteUuid: "unused",
    sourceExtractAt: "2026-07-03T00:00:00.000Z",
    pages: [
      {
        path: "/",
        sections: [
          {
            id: "home-hero",
            tag: "hero",
            order: 0,
            confidence: 0.9,
            source: "semantic",
            boundingBox: { x: 0, y: 0, width: 1440, height: 600 },
            crops: {
              desktop: "https://cdn/crops/home-hero-1440.png",
              mobile: "https://cdn/crops/home-hero-375.png",
            },
            innerText: "Welcome to Example",
            headingText: "Welcome to Example",
            mediaUrls: ["https://cdn/hero.jpg"],
            interactionIds: [],
          },
          {
            id: "home-features",
            tag: "feature-grid",
            order: 1,
            confidence: 0.85,
            source: "semantic",
            boundingBox: { x: 0, y: 600, width: 1440, height: 400 },
            crops: {
              desktop: "https://cdn/crops/home-features-1440.png",
              mobile: "https://cdn/crops/home-features-375.png",
            },
            innerText: "Feature list body",
            mediaUrls: [],
            interactionIds: [],
          },
        ],
        ladder: { rung1Count: 2, rung2Used: false, visionUsed: false },
      },
      {
        path: "/about",
        sections: [
          {
            id: "about-hero",
            tag: "hero",
            order: 0,
            confidence: 0.8,
            source: "semantic",
            boundingBox: { x: 0, y: 0, width: 1440, height: 400 },
            crops: {
              desktop: "https://cdn/crops/about-hero-1440.png",
              mobile: "https://cdn/crops/about-hero-375.png",
            },
            innerText: "About us body",
            headingText: "About us",
            mediaUrls: [],
            interactionIds: [],
          },
        ],
        ladder: { rung1Count: 1, rung2Used: false, visionUsed: false },
      },
    ],
    sharedComponents: [],
  };
}

function parseJsonBlock<T>(content: string): T {
  const match = content.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error("No JSON block found in doc content");
  return JSON.parse(match[1]!) as T;
}

describe("docgen stage", () => {
  let ctx: ArtifactContext;
  let config: Config;

  beforeEach(async () => {
    ctx = await seedSite();
    config = loadConfig();
  });

  it("emits all 9 docs for clone (replication) mode", async () => {
    await saveArtifact(db, ctx, "extract", stubExtract());
    await saveArtifact(db, ctx, "segment", stubSegment());

    const docs = await runDocgenStage({
      db,
      config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "replication",
    });

    const keys = docs.map((d) => d.key).sort();
    expect(keys).toEqual(
      [
        "brand-guidelines",
        "business-info",
        "design-system",
        "search-presence",
        "section-visual-evidence",
        "site-hierarchy",
        "site-memory",
        "site-strategy",
        "workspace-memory",
      ].sort(),
    );
  });

  it("search-presence contains per-page meta and the source baseline summary", async () => {
    await saveArtifact(db, ctx, "extract", stubExtract());
    await saveArtifact(db, ctx, "segment", stubSegment());

    const docs = await runDocgenStage({
      db,
      config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "replication",
    });

    const sp = docs.find((d) => d.key === "search-presence");
    expect(sp).toBeDefined();
    const parsed = parseJsonBlock<{
      pages: { path: string; metaTitle?: string }[];
      baseline: { lighthouse: { seo: number }[] };
      sitemapPresent: boolean;
    }>(sp!.content);
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]!.metaTitle).toBe("Example Gym");
    expect(parsed.baseline.lighthouse[0]!.seo).toBe(95);
    expect(parsed.sitemapPresent).toBe(true);
  });

  it("site-hierarchy carries multi-page buildOrder", async () => {
    await saveArtifact(db, ctx, "extract", stubExtract());
    await saveArtifact(db, ctx, "segment", stubSegment());

    const docs = await runDocgenStage({
      db,
      config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "replication",
    });

    const hier = docs.find((d) => d.key === "site-hierarchy");
    expect(hier).toBeDefined();
    const parsed = parseJsonBlock<{
      buildPlan: { buildOrder: string[]; nextPage: string };
      pages: { slug: string; isHomePage: boolean }[];
    }>(hier!.content);
    expect(parsed.pages.map((p) => p.slug).sort()).toEqual(["about", "index"]);
    expect(parsed.buildPlan.buildOrder).toContain("index");
    expect(parsed.buildPlan.buildOrder).toContain("about");
    expect(parsed.buildPlan.nextPage).toBe("index");
  });

  it("hybrid mode takes design docs from designSite and content from contentSite", async () => {
    // Set up two separate sites within the same workspace
    const contentCtx = ctx;
    const designSite = await db
      .insertInto("sites")
      .values({
        workspaceUuid: contentCtx.workspaceUuid,
        name: "Design Source",
        slug: `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    const designCtx: ArtifactContext = {
      siteUuid: designSite.uuid,
      workspaceUuid: contentCtx.workspaceUuid,
    };

    await saveArtifact(db, contentCtx, "extract", stubExtract({ url: "https://content.example" }));
    await saveArtifact(db, contentCtx, "segment", stubSegment());
    await saveArtifact(db, designCtx, "extract", stubExtract({ url: "https://design.example" }));
    await saveArtifact(db, designCtx, "segment", stubSegment());

    const docs = await runDocgenStage({
      db,
      config,
      siteUuid: contentCtx.siteUuid,
      workspaceUuid: contentCtx.workspaceUuid,
      mode: "template",
      contentSiteUuid: contentCtx.siteUuid,
      designSiteUuid: designCtx.siteUuid,
    });

    const ds = docs.find((d) => d.key === "design-system");
    expect(ds).toBeDefined();
    const parsed = parseJsonBlock<{ siteMetadata: { targetUrl?: string; mode: string } }>(
      ds!.content,
    );
    expect(parsed.siteMetadata.targetUrl).toBe("https://design.example");
    expect(parsed.siteMetadata.mode).toBe("template");

    // Site-hierarchy still tied to content site's url
    const hier = docs.find((d) => d.key === "site-hierarchy");
    const hierParsed = parseJsonBlock<{ siteMetadata: { targetUrl?: string } }>(hier!.content);
    expect(hierParsed.siteMetadata.targetUrl).toBe("https://content.example");
  });

  it("hybrid mode remaps evidence rows so every hierarchy section's evidenceId resolves", async () => {
    // Content site uses stubSegment() ids ("home-hero", "home-features",
    // "about-hero"). Design site uses distinct ids ("d-home-hero",
    // "d-home-features", "d-about-hero") on the same canonical tags. Without
    // remapping, content-side hierarchy evidenceIds would dangle against the
    // emitted design-keyed evidence rows.
    const contentCtx = ctx;
    const designSite = await db
      .insertInto("sites")
      .values({
        workspaceUuid: contentCtx.workspaceUuid,
        name: "Design Source Distinct",
        slug: `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    const designCtx: ArtifactContext = {
      siteUuid: designSite.uuid,
      workspaceUuid: contentCtx.workspaceUuid,
    };

    const designSegment: SegmentArtifact = {
      siteUuid: "unused",
      sourceExtractAt: "2026-07-03T00:00:00.000Z",
      pages: [
        {
          path: "/",
          sections: [
            {
              id: "d-home-hero",
              tag: "hero",
              order: 0,
              confidence: 0.9,
              source: "semantic",
              boundingBox: { x: 0, y: 0, width: 1440, height: 600 },
              crops: {
                desktop: "https://cdn/design/home-hero-1440.png",
                mobile: "https://cdn/design/home-hero-375.png",
              },
              innerText: "Design hero",
              headingText: "Design hero",
              mediaUrls: ["https://cdn/design/hero.jpg"],
              interactionIds: [],
            },
            {
              id: "d-home-features",
              tag: "feature-grid",
              order: 1,
              confidence: 0.85,
              source: "semantic",
              boundingBox: { x: 0, y: 600, width: 1440, height: 400 },
              crops: {
                desktop: "https://cdn/design/home-features-1440.png",
                mobile: "https://cdn/design/home-features-375.png",
              },
              innerText: "Design features",
              mediaUrls: [],
              interactionIds: [],
            },
          ],
          ladder: { rung1Count: 2, rung2Used: false, visionUsed: false },
        },
        {
          path: "/about",
          sections: [
            {
              id: "d-about-hero",
              tag: "hero",
              order: 0,
              confidence: 0.8,
              source: "semantic",
              boundingBox: { x: 0, y: 0, width: 1440, height: 400 },
              crops: {
                desktop: "https://cdn/design/about-hero-1440.png",
                mobile: "https://cdn/design/about-hero-375.png",
              },
              innerText: "Design about",
              headingText: "Design about",
              mediaUrls: [],
              interactionIds: [],
            },
          ],
          ladder: { rung1Count: 1, rung2Used: false, visionUsed: false },
        },
      ],
      sharedComponents: [],
    };

    await saveArtifact(db, contentCtx, "extract", stubExtract({ url: "https://content.example" }));
    await saveArtifact(db, contentCtx, "segment", stubSegment());
    await saveArtifact(db, designCtx, "extract", stubExtract({ url: "https://design.example" }));
    await saveArtifact(db, designCtx, "segment", designSegment);

    const docs = await runDocgenStage({
      db,
      config,
      siteUuid: contentCtx.siteUuid,
      workspaceUuid: contentCtx.workspaceUuid,
      mode: "template",
      contentSiteUuid: contentCtx.siteUuid,
      designSiteUuid: designCtx.siteUuid,
    });

    const hier = docs.find((d) => d.key === "site-hierarchy")!;
    const evidenceDoc = docs.find((d) => d.key === "section-visual-evidence")!;
    const hierParsed = parseJsonBlock<{
      pages: { slug: string; sections: { id: string; evidenceId: string; tag: string }[] }[];
    }>(hier.content);
    const evidenceParsed = parseJsonBlock<{
      rows: { evidenceId: string; sectionId: string; pageSlug: string; screenshotUrl?: string }[];
    }>(evidenceDoc.content);

    const evidenceIds = new Set(evidenceParsed.rows.map((r) => r.evidenceId));
    // Every content-side hierarchy section's evidenceId must resolve against the
    // emitted evidence doc's rows.
    for (const page of hierParsed.pages) {
      for (const section of page.sections) {
        expect(evidenceIds.has(section.evidenceId)).toBe(true);
      }
    }
    // And each remapped row must carry a design-side screenshot url (proving
    // the design row was actually copied, not the content-side raw evidence).
    for (const row of evidenceParsed.rows) {
      expect(row.screenshotUrl).toMatch(/\/design\//);
    }
  });

  it("greenfield mode emits the greenfield-plus-search-presence doc set", async () => {
    const docs = await runDocgenStage({
      db,
      config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "greenfield",
      greenfield: {
        site: { uuid: ctx.siteUuid, name: "Greenfield Site", workspaceUuid: ctx.workspaceUuid },
        brandMemory: {},
        businessInput: { businessName: "New Gym" },
      },
    });

    const keys = docs.map((d) => d.key);
    expect(keys).toContain("search-presence");
    expect(keys).toContain("site-hierarchy");
    expect(keys).toContain("design-system");
  });
});
