import { describe, expect, it, beforeEach, vi } from "vitest";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import { serveFixture } from "../fixtures/pipeline/serve-fixture";
import { runSegmentStage } from "../../src/services/pipeline/segment-stage";
import {
  saveArtifact,
  type ArtifactContext,
} from "../../src/utils/pipeline/artifact-store";
import { ConfigSchema, type Config } from "../../src/plugins/env";
import { getS3Client } from "../../src/s3";
import type { ExtractArtifact } from "../../src/types/pipeline-artifacts";

// Mock the llm-client at the module level so classifier + vision calls hit our
// stub. The classifier always requests plain-text messages; return a JSON
// array of `{index, tag}`. When the messages include an image_url part (vision
// path), we don't expect either fixture to reach it — but return an empty
// array just in case, so the ladder gracefully treats vision as unavailable.
vi.mock("../../src/ai/llm-client", async () => {
  return {
    chatCompletion: vi.fn(
      async (options: {
        messages: Array<{
          role: string;
          content:
            | string
            | Array<{ type: string; text?: string; image_url?: { url: string } }>;
        }>;
      }) => {
        const first = options.messages[0];
        const content = first?.content;
        const isVision =
          Array.isArray(content) &&
          content.some((p) => p.type === "image_url");
        if (isVision) {
          return { content: "[]" };
        }
        // Classifier path: parse the prompt to extract indices, then tag the
        // first one as hero (so our hero assertion holds) and fall back to
        // content-block for the rest.
        const promptText =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .filter((p) => p.type === "text")
                  .map((p) => p.text ?? "")
                  .join("\n")
              : "";
        const indexMatches = Array.from(
          promptText.matchAll(/"index":\s*(\d+)/g),
        ).map((m) => Number(m[1]));
        const uniqueIndices = Array.from(new Set(indexMatches));
        const tagged = uniqueIndices.map((index, i) => ({
          index,
          tag: i === 0 ? "hero" : "content-block",
        }));
        return { content: JSON.stringify(tagged) };
      },
    ),
    // Re-export the surface segment-stage's TS imports touch. sanitize/error
    // aren't called at runtime here but keep parity if that changes.
    LlmClientError: class LlmClientError extends Error {},
    sanitizeRawResponse: (r: unknown) => r,
  };
});

async function seed(): Promise<ArtifactContext> {
  const { workspace } = await setupTestContext();
  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid: workspace.uuid,
      name: "Segment Stage Test",
      slug: `segment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { siteUuid: site.uuid, workspaceUuid: workspace.uuid };
}

function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

function stubExtractArtifact(url: string): ExtractArtifact {
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
        media: [],
        screenshots: {
          full1440: `${url}fixture-1440.png`,
          vp768: `${url}fixture-768.png`,
          vp375: `${url}fixture-375.png`,
        },
        content: {
          title: "Home",
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
      capturedAt: new Date().toISOString(),
      lighthouse: [],
      axe: [{ path: "/", violations: [] }],
      network: [
        { path: "/", totalBytes: 100, requestCount: 1, imageBytes: 0 },
      ],
    },
    usage: { pagesCaptured: 1, screenshotCount: 3 },
  };
}

describe("segment stage", () => {
  let ctx: ArtifactContext;
  let config: Config;

  beforeEach(async () => {
    ctx = await seed();
    config = loadConfig();
  });

  it(
    "segments the semantic fixture without vision and produces crops",
    async () => {
      const fixture = await serveFixture("semantic");
      await saveArtifact(db, ctx, "extract", stubExtractArtifact(fixture.url));

      const s3 = getS3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
        sessionToken: config.S3_SESSION_TOKEN,
      });

      try {
        const artifact = await runSegmentStage({
          db,
          config,
          s3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          pages: ["/"],
        });

        const home = artifact.pages.find((p) => p.path === "/");
        expect(home).toBeDefined();
        expect(home!.sections.length).toBeGreaterThanOrEqual(4);
        expect(home!.ladder.visionUsed).toBe(false);
        expect(home!.sections[0]!.crops.desktop).toMatch(/^http/);
        expect(home!.sections.every((s, i) => s.order === i)).toBe(true);
        expect(home!.sections.some((s) => s.tag === "hero")).toBe(true);
      } finally {
        await fixture.close();
      }
    },
    180_000,
  );

  it(
    "uses rung 2 on the div-soup fixture without vision and still yields >= 3 sections",
    async () => {
      const fixture = await serveFixture("div-soup");
      await saveArtifact(db, ctx, "extract", stubExtractArtifact(fixture.url));

      const s3 = getS3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
        sessionToken: config.S3_SESSION_TOKEN,
      });

      try {
        const artifact = await runSegmentStage({
          db,
          config,
          s3,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          pages: ["/"],
        });

        const home = artifact.pages[0]!;
        expect(home.sections.length).toBeGreaterThanOrEqual(3);
        expect(home.ladder.rung2Used).toBe(true);
        expect(home.ladder.visionUsed).toBe(false);
      } finally {
        await fixture.close();
      }
    },
    180_000,
  );
});
