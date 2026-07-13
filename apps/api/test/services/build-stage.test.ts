import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm, stat, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import {
  runBuildStage,
  renderSharedComponents,
} from "../../src/services/pipeline/build-stage";
import { saveSiteHierarchyDoc } from "../../src/utils/site-hierarchy-io";
import { saveDesignSystemDoc } from "../../src/utils/design-system-io";
import { saveSectionVisualEvidenceDoc } from "../../src/utils/section-visual-evidence-io";
import { ConfigSchema, type Config } from "../../src/plugins/env";
import type { ArtifactContext } from "../../src/utils/pipeline/artifact-store";
import type { SiteHierarchy } from "../../src/types/site-hierarchy";
import type { DesignSystemV2 } from "../../src/types/design-system-v2";
import type { SectionVisualEvidence } from "../../src/types/section-visual-evidence";
import type { S3Client } from "@aws-sdk/client-s3";

// The build stage's only LLM call site is `renderVisualBlock` — mock it to
// return a minimal, valid Astro component so the test doesn't hit a network.
vi.mock("../../src/ai/llm-client", async () => {
  return {
    chatCompletion: vi.fn(async () => ({
      content: `---
---
<section class="py-16 px-6">
  <div class="max-w-6xl mx-auto">
    <h2>Hero heading</h2>
  </div>
</section>`,
    })),
    LlmClientError: class LlmClientError extends Error {},
    sanitizeRawResponse: (r: unknown) => r,
  };
});

async function seedSite(): Promise<ArtifactContext> {
  const { workspace } = await setupTestContext();
  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid: workspace.uuid,
      name: "Build Stage Test",
      slug: `build-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, workspaceUuid: workspace.uuid };
}

function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

/**
 * A minimal stub S3 client — the build stage only hits S3 for media
 * re-hosting, which we sidestep by seeding hierarchies without external
 * image URLs (data: URIs and empty images arrays are both skipped).
 */
const stubS3: S3Client = {} as S3Client;

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
        fonts: { heading: "Sans-serif", body: "Sans-serif" },
        radius: "0.5rem",
      },
      shell: {
        navLinks: [{ label: "Home", href: "/" }],
      },
      rules: {},
    },
    business: { name: "Acme Gym", tagline: "Train with purpose" },
    brand: {
      logo: { type: "text", value: "Acme Gym" },
      headingStyle: { uppercase: false, bold: true },
    },
    reference: {},
  };
}

function makeSingleHierarchy(): SiteHierarchy {
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
        metaTitle: "Home",
        metaDescription: "Welcome",
        sections: [
          {
            id: "home-hero",
            tag: "hero",
            intent: "Introduce the gym",
            content: {
              heading: "Train harder",
              body: "The best gym in town",
              cta: { label: "Join", href: "/join" },
            },
            evidenceId: "ev-home-hero",
          },
          {
            id: "home-about",
            tag: "content-block",
            intent: "About the gym",
            content: { heading: "About us", body: "Community-driven fitness" },
            evidenceId: "ev-home-about",
          },
        ],
      },
    ],
    buildPlan: {
      buildOrder: ["index"],
      nextPage: "index",
      pageStatus: { index: "planned" },
    },
  };
}

function makeSharedHierarchy(): SiteHierarchy {
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
            id: "home-hero",
            tag: "hero",
            intent: "hero",
            content: { heading: "Home hero" },
            evidenceId: "ev-home-hero",
          },
          {
            id: "home-locations",
            tag: "location-block",
            intent: "Locations block",
            content: { heading: "Locations" },
            evidenceId: "ev-home-locations",
            sharedComponentId: "shared-0",
            sharedProps: { title: "Locations" },
          },
        ],
      },
      {
        slug: "about",
        isHomePage: false,
        title: "About",
        sections: [
          {
            id: "about-hero",
            tag: "hero",
            intent: "hero",
            content: { heading: "About hero" },
            evidenceId: "ev-about-hero",
          },
          {
            id: "about-locations",
            tag: "location-block",
            intent: "Locations block",
            content: { heading: "Locations" },
            evidenceId: "ev-about-locations",
            sharedComponentId: "shared-0",
            sharedProps: { title: "Locations" },
          },
        ],
      },
    ],
    buildPlan: {
      buildOrder: ["index", "about"],
      nextPage: "index",
      pageStatus: { index: "planned", about: "planned" },
    },
  };
}

function makeEvidence(rows: string[]): SectionVisualEvidence {
  return {
    version: "1",
    rows: rows.map((id) => ({
      evidenceId: id,
      pageSlug: id.startsWith("ev-home") ? "index" : "about",
      sectionId: id.replace(/^ev-/, ""),
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: [],
      screenshotUrl: `https://example.com/${id}.png`,
    })),
  };
}

describe("build stage", () => {
  let ctx: ArtifactContext;
  let config: Config;
  let tmpDir: string;

  beforeEach(async () => {
    ctx = await seedSite();
    config = loadConfig();
    tmpDir = path.join(
      os.tmpdir(),
      `milo-build-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("builds a single page from seeded docs and writes astro files", async () => {
    const hierarchy = makeSingleHierarchy();
    const designSystem = makeDesignSystem();
    const evidence = makeEvidence(["ev-home-hero", "ev-home-about"]);

    await saveSiteHierarchyDoc(db, ctx.workspaceUuid, ctx.siteUuid, hierarchy);
    await saveDesignSystemDoc(db, ctx.workspaceUuid, ctx.siteUuid, designSystem);
    await saveSectionVisualEvidenceDoc(db, ctx.workspaceUuid, ctx.siteUuid, evidence);

    const result = await runBuildStage({
      db,
      config,
      s3: stubS3,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      pages: ["index"],
      sourceDir: tmpDir,
    });

    expect(result.builtPages).toEqual(["index"]);
    expect(result.fallbacks).toEqual([]);

    // index.astro exists
    const indexPath = path.join(tmpDir, "src", "pages", "index.astro");
    const indexSrc = await readFile(indexPath, "utf8");
    expect(indexSrc).toContain("import Layout");
    expect(indexSrc).toContain("home-hero");
    expect(indexSrc).toContain("home-about");

    // section component files exist
    await stat(path.join(tmpDir, "src", "components", "sections", "home-hero.astro"));
    await stat(path.join(tmpDir, "src", "components", "sections", "home-about.astro"));

    // scaffold files exist
    await stat(path.join(tmpDir, "package.json"));
    await stat(path.join(tmpDir, "src", "styles", "tokens.css"));

    // Media re-hosting log entries: no external images seeded, so no entries.
    const perfEntries = result.buildLog.filter((l) => l.category === "performance");
    expect(perfEntries.length).toBe(0);
  });

  it("renders a shared component once and imports it on both pages", async () => {
    const hierarchy = makeSharedHierarchy();
    const designSystem = makeDesignSystem();
    const evidence = makeEvidence([
      "ev-home-hero",
      "ev-home-locations",
      "ev-about-hero",
      "ev-about-locations",
    ]);

    await saveSiteHierarchyDoc(db, ctx.workspaceUuid, ctx.siteUuid, hierarchy);
    await saveDesignSystemDoc(db, ctx.workspaceUuid, ctx.siteUuid, designSystem);
    await saveSectionVisualEvidenceDoc(db, ctx.workspaceUuid, ctx.siteUuid, evidence);

    const result = await runBuildStage({
      db,
      config,
      s3: stubS3,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      sourceDir: tmpDir,
    });

    expect(result.sharedComponentsBuilt).toContain("shared-0");
    expect(result.sharedComponentsBuilt.length).toBe(1);
    expect(result.builtPages.sort()).toEqual(["about", "index"]);

    // Only one shared-0.astro file exists
    const sharedDir = path.join(tmpDir, "src", "components", "shared");
    const sharedFiles = await readdir(sharedDir);
    const shared0Files = sharedFiles.filter((f) => f === "shared-0.astro");
    expect(shared0Files).toEqual(["shared-0.astro"]);

    // Both pages import the shared component
    const indexSrc = await readFile(path.join(tmpDir, "src", "pages", "index.astro"), "utf8");
    const aboutSrc = await readFile(path.join(tmpDir, "src", "pages", "about.astro"), "utf8");
    expect(indexSrc).toContain("../components/shared/shared-0.astro");
    expect(aboutSrc).toContain("../components/shared/shared-0.astro");

    // Section files for the shared members are NOT written
    let missing = 0;
    for (const id of ["home-locations", "about-locations"]) {
      try {
        await stat(path.join(tmpDir, "src", "components", "sections", `${id}.astro`));
      } catch {
        missing += 1;
      }
    }
    expect(missing).toBe(2);
  });

  it("renderSharedComponents renders shared components for a single-page input (buildPage path)", async () => {
    // Regression: the legacy `buildPage` orchestrator used to skip
    // `sharedComponentId` sections without writing the shared component
    // files, causing astro build to fail with a missing-import error. Both
    // paths now use `renderSharedComponents` — this test locks in the
    // single-page invocation the orchestrator uses.
    const hierarchy = makeSharedHierarchy();
    const designSystem = makeDesignSystem();
    const evidence = makeEvidence([
      "ev-home-hero",
      "ev-home-locations",
      "ev-about-hero",
      "ev-about-locations",
    ]);

    const indexPage = hierarchy.pages.find((p) => p.slug === "index");
    if (!indexPage) throw new Error("expected index page in shared hierarchy fixture");

    const built = await renderSharedComponents(
      [indexPage],
      designSystem,
      evidence,
      config,
    );

    expect(built.size).toBe(1);
    expect(built.has("shared-0")).toBe(true);
    const source = built.get("shared-0") ?? "";
    // The vitest mock at the top returns a minimal <section>-based Astro
    // component; confirm we got Astro source back and not an empty string.
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("<section");
  });
});
