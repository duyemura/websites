import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import { serveFixture } from "../fixtures/pipeline/serve-fixture";
import { runExtractStage } from "../../src/services/pipeline/extract-stage";
import {
  saveArtifact,
  loadArtifact,
  type ArtifactContext,
} from "../../src/utils/pipeline/artifact-store";
import { ConfigSchema, type Config } from "../../src/plugins/env";
import { getS3Client } from "../../src/s3";
import type { ExtractArtifact } from "../../src/types/pipeline-artifacts";

async function seed(): Promise<ArtifactContext> {
  const { workspace } = await setupTestContext();
  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid: workspace.uuid,
      name: "Extract Stage Test",
      slug: `extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, workspaceUuid: workspace.uuid };
}

function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

describe("extract stage", () => {
  let ctx: ArtifactContext;
  let config: Config;

  beforeEach(async () => {
    ctx = await seed();
    config = loadConfig();
  });

  it(
    "produces a valid extract artifact for a single-page site (homepage scope)",
    async () => {
      const fixture = await serveFixture("semantic");
      const s3 = getS3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
        sessionToken: config.S3_SESSION_TOKEN,
      });

      try {
        const artifact = await runExtractStage({
          db,
          config,
          s3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          url: fixture.url,
          pages: ["/"],
        });

        expect(artifact.siteMap.length).toBeGreaterThanOrEqual(1);
        expect(artifact.pages).toHaveLength(1);
        expect(artifact.pages[0]?.content.businessName).toBe("Semantic Gym");
        expect(artifact.css.tokens["--brand"]).toBe("#e63946");
        expect(artifact.pages[0]?.screenshots.full1440).toMatch(/^http/);
        expect(artifact.pages[0]?.screenshots.vp768).toMatch(/^http/);
        expect(artifact.pages[0]?.screenshots.vp375).toMatch(/^http/);
        expect(artifact.sourceBaseline.axe).toHaveLength(1);
        expect(artifact.sourceBaseline.axe[0]?.path).toBe("/");
        expect(artifact.sourceBaseline.network).toHaveLength(1);
        expect(artifact.usage.pagesCaptured).toBe(1);

        const stored = await loadArtifact<ExtractArtifact>(db, ctx, "extract");
        expect(stored?.version).toBe(1);
        expect(stored?.payload.pages).toHaveLength(1);
      } finally {
        await fixture.close();
      }
    },
    180_000,
  );

  it(
    "merges on write: re-running one page preserves other pages",
    async () => {
      // Seed a prior artifact that already contains "/" and "/about" pages so
      // the merge-on-write branch is exercised. The prior "/" entry should be
      // overwritten by the fresh capture, and "/about" should be preserved.
      const priorArtifact: ExtractArtifact = {
        url: "http://prior.local/",
        extractedAt: new Date(Date.now() - 60_000).toISOString(),
        siteMap: [
          {
            url: "http://prior.local/",
            path: "/",
            title: "Home",
            classification: "structural",
            source: "nav",
            status: "captured",
          },
          {
            url: "http://prior.local/about",
            path: "/about",
            title: "About",
            classification: "structural",
            source: "nav",
            status: "captured",
          },
        ],
        css: { tokens: {}, breakpoints: [], animations: [] },
        pages: [
          {
            path: "/",
            media: [],
            screenshots: {
              full1440: "http://prior.local/root-1440.png",
              vp768: "http://prior.local/root-768.png",
              vp375: "http://prior.local/root-375.png",
            },
            content: {
              title: "Prior Home",
              headings: [],
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
          {
            path: "/about",
            media: [],
            screenshots: {
              full1440: "http://prior.local/about-1440.png",
              vp768: "http://prior.local/about-768.png",
              vp375: "http://prior.local/about-375.png",
            },
            content: {
              title: "Prior About",
              headings: [],
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
          capturedAt: new Date(Date.now() - 60_000).toISOString(),
          lighthouse: [],
          axe: [
            { path: "/", violations: [] },
            { path: "/about", violations: [] },
          ],
          network: [
            { path: "/", totalBytes: 100, requestCount: 1, imageBytes: 0 },
            {
              path: "/about",
              totalBytes: 100,
              requestCount: 1,
              imageBytes: 0,
            },
          ],
        },
        usage: { pagesCaptured: 2, screenshotCount: 6 },
      };

      await saveArtifact(db, ctx, "extract", priorArtifact);

      const fixture = await serveFixture("semantic");
      const s3 = getS3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
        sessionToken: config.S3_SESSION_TOKEN,
      });

      try {
        const artifact = await runExtractStage({
          db,
          config,
          s3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          url: fixture.url,
          pages: ["/"],
        });

        const paths = artifact.pages.map((p) => p.path).sort();
        expect(paths).toEqual(["/", "/about"]);

        // "/" was re-captured, so it should have a real http URL, not the
        // prior stub URL.
        const home = artifact.pages.find((p) => p.path === "/");
        expect(home?.content.title).toBe("Semantic Gym");
        expect(home?.screenshots.full1440).toMatch(/^http/);

        // "/about" is preserved from the prior artifact.
        const about = artifact.pages.find((p) => p.path === "/about");
        expect(about?.content.title).toBe("Prior About");

        // axe/network for /about are preserved too.
        expect(
          artifact.sourceBaseline.axe.map((a) => a.path).sort(),
        ).toEqual(["/", "/about"]);
        expect(
          artifact.sourceBaseline.network.map((n) => n.path).sort(),
        ).toEqual(["/", "/about"]);

        const stored = await loadArtifact<ExtractArtifact>(db, ctx, "extract");
        expect(stored?.version).toBe(2);
        expect(stored?.payload.pages.map((p) => p.path).sort()).toEqual([
          "/",
          "/about",
        ]);
      } finally {
        await fixture.close();
      }
    },
    180_000,
  );
});
