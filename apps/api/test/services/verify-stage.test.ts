import { describe, expect, it, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import { runVerifyStage } from "../../src/services/pipeline/verify-stage";
import {
  saveArtifact,
  loadArtifact,
  type ArtifactContext,
} from "../../src/utils/pipeline/artifact-store";
import { saveSiteHierarchyDoc } from "../../src/utils/site-hierarchy-io";
import { saveDesignSystemDoc } from "../../src/utils/design-system-io";
import { ConfigSchema, type Config } from "../../src/plugins/env";
import type { S3Client } from "@aws-sdk/client-s3";
import type {
  ExtractArtifact,
  VerifyArtifact,
} from "../../src/types/pipeline-artifacts";
import type { SiteHierarchy } from "../../src/types/site-hierarchy";
import type { DesignSystemV2 } from "../../src/types/design-system-v2";

// Mock the LLM client so the vision-compare step returns a deterministic
// stub instead of hitting the real model. The verify stage sends `image_url`
// parts; anything vision-shaped gets a static 90/[] response.
vi.mock("../../src/ai/llm-client", async () => {
  return {
    chatCompletion: vi.fn(async () => ({
      content: JSON.stringify({ score: 90, differences: [] }),
    })),
    LlmClientError: class LlmClientError extends Error {},
    sanitizeRawResponse: (r: unknown) => r,
  };
});

const stubS3: S3Client = {} as S3Client;

async function seed(): Promise<ArtifactContext> {
  const { workspace } = await setupTestContext();
  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid: workspace.uuid,
      name: "Verify Stage Test",
      slug: `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, workspaceUuid: workspace.uuid };
}

function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

/**
 * Serves a hand-crafted "built clone" HTML page. Includes structured data,
 * semantic landmarks, and a meta description — the clone signals the
 * baseline diff needs to see to derive improvements.
 */
interface ServeCloneOptions {
  /** Section ids that appear on `/`. */
  sectionIds?: string[];
  /** Section ids that appear on `/about`. Optional multi-page clone. */
  aboutSectionIds?: string[];
  /** Extra HTML injected into the home page's <main> (e.g. an accordion). */
  extraMainHtml?: string;
}

async function serveClone(
  arg: string[] | ServeCloneOptions,
): Promise<{ url: string; close: () => Promise<void> }> {
  const opts: ServeCloneOptions = Array.isArray(arg) ? { sectionIds: arg } : arg;
  const homeSections = (opts.sectionIds ?? [])
    .map(
      (id) =>
        `<section data-section-id="${id}" id="${id}"><h2>${id}</h2><p>Content for ${id}</p></section>`,
    )
    .join("\n");
  const aboutSections = (opts.aboutSectionIds ?? [])
    .map(
      (id) =>
        `<section data-section-id="${id}" id="${id}"><h2>${id}</h2><p>About content for ${id}</p></section>`,
    )
    .join("\n");
  const pageHtml = (title: string, body: string): string => `<!doctype html>
<html>
<head>
  <title>${title}</title>
  <meta name="description" content="A rebuilt clone of the source">
  <script type="application/ld+json">${JSON.stringify({ "@type": "LocalBusiness", name: "Cloned Gym" })}</script>
</head>
<body style="font-family: 'Helvetica Neue', sans-serif; color: rgb(23, 23, 23);">
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main>
    ${body}
  </main>
  <footer><p>Contact</p></footer>
</body>
</html>`;
  const homeHtml = pageHtml(
    "Cloned Gym",
    `${homeSections}\n${opts.extraMainHtml ?? ""}`,
  );
  const aboutHtml = pageHtml("About — Cloned Gym", aboutSections);
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    const clean = url.split("?")[0]!.replace(/\/+$/, "") || "/";
    if (clean === "/about") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(aboutHtml);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(homeHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}

function makeExtract(url: string): ExtractArtifact {
  return {
    url,
    extractedAt: new Date().toISOString(),
    siteMap: [
      {
        url,
        path: "/",
        title: "Home",
        classification: "structural",
        source: "nav",
        status: "captured",
      },
    ],
    css: { tokens: {}, breakpoints: [], animations: [] },
    pages: [
      {
        path: "/",
        media: [
          { url: "https://cdn.example.com/hero.jpg", contentType: "image/jpeg", resourceType: "image", bytes: 5_000_000 },
        ],
        screenshots: {
          full1440: `${url}source-1440.png`,
          vp768: `${url}source-768.png`,
          vp375: `${url}source-375.png`,
        },
        content: {
          title: "Home",
          headings: [{ level: 1, text: "Welcome" }],
          navLinks: [{ label: "Home", href: "/" }],
          meta: {},
          // Source has no structured data — clone will beat it.
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
      capturedAt: new Date().toISOString(),
      lighthouse: [
        // Baseline: mediocre scores so the clone-vs-original delta is
        // computed (even if clone lighthouse fails in the test env, we still
        // emit a well-formed ScoreDelta).
        { path: "/", preset: "mobile", performance: 40, seo: 70, accessibility: 60, bestPractices: 70 },
        { path: "/", preset: "desktop", performance: 55, seo: 70, accessibility: 60, bestPractices: 75 },
      ],
      axe: [
        {
          path: "/",
          violations: [
            { id: "color-contrast", impact: "serious", nodes: 5 },
            { id: "image-alt", impact: "critical", nodes: 3 },
          ],
        },
      ],
      network: [
        { path: "/", totalBytes: 6_000_000, requestCount: 20, imageBytes: 5_000_000 },
      ],
    },
    usage: { pagesCaptured: 1, screenshotCount: 3 },
  };
}

function makeHierarchy(): SiteHierarchy {
  return {
    version: "1",
    siteMetadata: {
      framework: "astro",
      mode: "replication",
      targetUrl: "https://example.com",
      generatedAt: new Date().toISOString(),
    },
    pages: [
      {
        slug: "index",
        isHomePage: true,
        title: "Home",
        sections: [
          {
            id: "hero",
            tag: "hero",
            intent: "hero",
            content: { heading: "Hero" },
            evidenceId: "ev-hero",
          },
          {
            id: "features",
            tag: "feature-grid",
            intent: "features",
            content: { heading: "Features" },
            evidenceId: "ev-features",
          },
        ],
      },
    ],
    buildPlan: {
      buildOrder: ["index"],
      nextPage: "index",
      pageStatus: { index: "built" },
    },
  };
}

function makeDesignSystem(): DesignSystemV2 {
  return {
    version: "2",
    siteMetadata: {
      framework: "astro",
      mode: "replication",
      targetUrl: "https://example.com",
      generatedAt: new Date().toISOString(),
    },
    global: {
      tokens: {
        colors: {
          primary: "#171717",
          primaryForeground: "#ffffff",
          background: "#ffffff",
          foreground: "#171717",
          muted: "#f5f5f5",
          mutedForeground: "#737373",
          border: "#e5e5e5",
        },
        fonts: { heading: "Helvetica Neue", body: "Helvetica Neue" },
        radius: "0.5rem",
      },
      shell: { navLinks: [{ label: "Home", href: "/" }] },
      rules: {},
    },
    business: { name: "Cloned Gym", tagline: "A test clone" },
    brand: { logo: { type: "text", value: "Cloned Gym" }, headingStyle: { uppercase: false, bold: true } },
    reference: {},
  };
}

describe("verify stage", () => {
  let ctx: ArtifactContext;
  let config: Config;

  beforeEach(async () => {
    ctx = await seed();
    config = loadConfig();
  });

  it(
    "produces a valid VerifyArtifact with derived improvements and fidelity scores",
    async () => {
      const clone = await serveClone(["hero", "features"]);
      const extract = makeExtract(clone.url);
      await saveArtifact(db, ctx, "extract", extract);
      // Build artifact: one fallback + one build-log entry to prove passthrough.
      await saveArtifact(db, ctx, "build", {
        builtPages: ["index"],
        sharedComponentsBuilt: [],
        buildLog: [
          {
            category: "performance",
            description: "Re-hosted https://cdn.example.com/hero.jpg",
            page: "index",
          },
        ],
        fallbacks: [{ sectionId: "hero", page: "index" }],
      });
      await saveSiteHierarchyDoc(db, ctx.workspaceUuid, ctx.siteUuid, makeHierarchy());
      await saveDesignSystemDoc(db, ctx.workspaceUuid, ctx.siteUuid, makeDesignSystem());

      try {
        const artifact = await runVerifyStage({
          db,
          config,
          s3: stubS3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          servedUrl: clone.url,
        });

        // Scores are populated + master fidelity is in [0, 100].
        expect(artifact.scores.masterFidelity).toBeGreaterThanOrEqual(0);
        expect(artifact.scores.masterFidelity).toBeLessThanOrEqual(100);
        expect(artifact.scores.mechanicalFidelity).toBeGreaterThanOrEqual(0);
        expect(artifact.scores.visualFidelity).toBe(90); // mock

        // Per-page vision block populated from the mocked LLM.
        expect(artifact.pages).toHaveLength(1);
        expect(artifact.pages[0]?.vision.score1440).toBe(90);
        expect(artifact.pages[0]?.vision.score375).toBe(90);

        // Improvements: baseline diff should include seo (schema added),
        // semantics (0→>2 landmarks), and seo (meta description added).
        const categories = artifact.improvements.map((i) => i.category);
        expect(categories).toContain("seo");
        expect(categories).toContain("semantics");
        // build-log improvement should pass through as source: "build-log"
        const buildLog = artifact.improvements.find((i) => i.source === "build-log");
        expect(buildLog).toBeDefined();
        expect(buildLog?.description).toContain("Re-hosted");
        // baseline-diff improvements exist.
        const baseline = artifact.improvements.filter((i) => i.source === "baseline-diff");
        expect(baseline.length).toBeGreaterThan(0);

        // Fallback → actionable
        const fallbackActionable = artifact.actionable.find(
          (a) => a.sectionId === "hero" && a.suggestedStage === "build",
        );
        expect(fallbackActionable).toBeDefined();

        // Persisted with same shape.
        const stored = await loadArtifact<VerifyArtifact>(db, ctx, "verify");
        expect(stored?.version).toBe(1);
        expect(stored?.payload.pages).toHaveLength(1);
        expect(stored?.payload.scores.visualFidelity).toBe(90);
      } finally {
        await clone.close();
      }
    },
    120_000,
  );

  it(
    "scopes section-present checks to the current page only (multi-page regression)",
    async () => {
      // Multi-page hierarchy: `/` has hero+features, `/about` has team+contact.
      // The clone serves both pages. When we verify only `/`, the runner must
      // not record failures for /about's team+contact section ids.
      const clone = await serveClone({
        sectionIds: ["hero", "features"],
        aboutSectionIds: ["team", "contact"],
      });
      const extract = makeExtract(clone.url);
      // Add /about to the extract so scope defaults include it — but we'll
      // pass an explicit scope of just ["/"] to prove per-page scoping.
      extract.pages.push({
        ...extract.pages[0]!,
        path: "/about",
      });
      extract.siteMap.push({
        url: `${clone.url}about`,
        path: "/about",
        title: "About",
        classification: "structural",
        source: "nav",
        status: "captured",
      });
      await saveArtifact(db, ctx, "extract", extract);
      await saveArtifact(db, ctx, "build", {
        builtPages: ["index", "about"],
        sharedComponentsBuilt: [],
        buildLog: [],
        fallbacks: [],
      });

      const hierarchy = makeHierarchy();
      hierarchy.pages.push({
        slug: "about",
        isHomePage: false,
        title: "About",
        sections: [
          {
            id: "team",
            tag: "team",
            intent: "team",
            content: { heading: "Team" },
            evidenceId: "ev-team",
          },
          {
            id: "contact",
            tag: "contact",
            intent: "contact",
            content: { heading: "Contact" },
            evidenceId: "ev-contact",
          },
        ],
      });
      hierarchy.buildPlan.buildOrder = ["index", "about"];
      hierarchy.buildPlan.pageStatus = { index: "built", about: "built" };
      await saveSiteHierarchyDoc(db, ctx.workspaceUuid, ctx.siteUuid, hierarchy);
      await saveDesignSystemDoc(db, ctx.workspaceUuid, ctx.siteUuid, makeDesignSystem());

      try {
        const artifact = await runVerifyStage({
          db,
          config,
          s3: stubS3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          servedUrl: clone.url,
          pages: ["/"],
        });

        expect(artifact.pages).toHaveLength(1);
        const home = artifact.pages[0]!;
        expect(home.path).toBe("/");
        const homeCheckIds = [
          ...home.mechanical.passed.map((c) => c.id),
          ...home.mechanical.failed.map((c) => c.id),
        ];
        // Only sections belonging to `/` should generate checks.
        expect(homeCheckIds).toContain("section-hero");
        expect(homeCheckIds).toContain("section-features");
        expect(homeCheckIds).not.toContain("section-team");
        expect(homeCheckIds).not.toContain("section-contact");

        // No critical failures for /about sections should have leaked into
        // the aggregate — masterFidelity should not be capped at 79.
        const stray = home.mechanical.failed.filter(
          (c) => c.id === "section-team" || c.id === "section-contact",
        );
        expect(stray).toHaveLength(0);
      } finally {
        await clone.close();
      }
    },
    120_000,
  );

  it(
    "records an interaction-health check when the clone honors interactive patterns",
    async () => {
      // Clone has an accordion (<details/summary>). The extract records one
      // interaction; the semantic interaction checker discovers the summary
      // and verifies the pattern is functional.
      const accordion =
        `<details id="faq-1"><summary class="faq-summary">Question</summary><p>Answer</p></details>`;
      const clone = await serveClone({
        sectionIds: ["hero", "features"],
        extraMainHtml: accordion,
      });
      const extract = makeExtract(clone.url);
      extract.pages[0]!.interactions = [
        {
          id: "int-faq-1",
          trigger: "click",
          selector: "#faq-1 > summary",
          beforeUrl: `${clone.url}before.png`,
          afterUrl: `${clone.url}after.png`,
          styleDiff: [],
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
        },
      ];
      await saveArtifact(db, ctx, "extract", extract);
      await saveArtifact(db, ctx, "build", {
        builtPages: ["index"],
        sharedComponentsBuilt: [],
        buildLog: [],
        fallbacks: [],
      });
      await saveSiteHierarchyDoc(db, ctx.workspaceUuid, ctx.siteUuid, makeHierarchy());
      await saveDesignSystemDoc(db, ctx.workspaceUuid, ctx.siteUuid, makeDesignSystem());

      try {
        const artifact = await runVerifyStage({
          db,
          config,
          s3: stubS3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          servedUrl: clone.url,
        });
        const home = artifact.pages[0]!;
        const interactionChecks = [
          ...home.mechanical.passed,
          ...home.mechanical.failed,
        ].filter((c) => c.id.startsWith("interaction-"));
        expect(interactionChecks).toHaveLength(1);
        // With the accordion present the interaction-health check must pass.
        const passedIds = home.mechanical.passed.map((c) => c.id);
        expect(passedIds).toContain("interaction-health");
      } finally {
        await clone.close();
      }
    },
    120_000,
  );

  it(
    "fails interaction-health critically when the clone omits interactive patterns",
    async () => {
      // Same extract interaction, but the clone does NOT contain any
      // interactive elements. The semantic checker records a critical failure
      // and routes an actionable entry to the build stage.
      const clone = await serveClone({
        sectionIds: ["hero", "features"],
      });
      const extract = makeExtract(clone.url);
      extract.pages[0]!.interactions = [
        {
          id: "int-faq-missing",
          trigger: "click",
          selector: "#faq-1 > summary",
          beforeUrl: `${clone.url}before.png`,
          afterUrl: `${clone.url}after.png`,
          styleDiff: [],
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
        },
      ];
      await saveArtifact(db, ctx, "extract", extract);
      await saveArtifact(db, ctx, "build", {
        builtPages: ["index"],
        sharedComponentsBuilt: [],
        buildLog: [],
        fallbacks: [],
      });
      await saveSiteHierarchyDoc(db, ctx.workspaceUuid, ctx.siteUuid, makeHierarchy());
      await saveDesignSystemDoc(db, ctx.workspaceUuid, ctx.siteUuid, makeDesignSystem());

      try {
        const artifact = await runVerifyStage({
          db,
          config,
          s3: stubS3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          servedUrl: clone.url,
        });
        const home = artifact.pages[0]!;
        const failed = home.mechanical.failed.find(
          (c) => c.id === "interaction-health",
        );
        expect(failed).toBeDefined();
        expect(failed?.critical).toBe(true);

        // Actionable routing: interaction failures suggest build stage.
        const actionable = artifact.actionable.find(
          (a) => a.issue.startsWith("interaction dead"),
        );
        expect(actionable).toBeDefined();
        expect(actionable?.suggestedStage).toBe("build");
      } finally {
        await clone.close();
      }
    },
    120_000,
  );
});
