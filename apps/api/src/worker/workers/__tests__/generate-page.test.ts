import { describe, test, expect, vi } from "vitest";
import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import { generatePageProcessor } from "../generate-page";

const buildPage = vi.fn();

vi.mock("../../../services/site-generation-orchestrator.js", () => ({
  buildPage,
}));

function makeFastify(): FastifyInstance {
  return {
    db: {} as never,
    queues: {
      generatePage: {} as never,
    } as never,
    config: { LLM_PROVIDER: "openai" } as never,
    log: { info: vi.fn() },
  } as unknown as FastifyInstance;
}

function makeJob(data: {
  workspaceUuid: string;
  siteUuid: string;
  pageSlug: string;
  aiJobUuid: string;
  attemptId: string;
  mode?: "replication" | "template" | "greenfield";
  referenceScreenshotUrl?: string | null;
}): Job {
  return { id: "job-1", data } as Job;
}

describe("generate-page worker", () => {
  test("forwards all payload fields to buildPage", async () => {
    const fastify = makeFastify();
    const processor = generatePageProcessor(fastify);

    const data = {
      workspaceUuid: "ws-1",
      siteUuid: "site-1",
      pageSlug: "index",
      aiJobUuid: "job-1",
      attemptId: "attempt-1",
      mode: "replication" as const,
      referenceScreenshotUrl: "https://cdn.example.com/ref.png",
    };

    buildPage.mockResolvedValueOnce({
      pageSlug: "index",
      passed: true,
      fidelityScore: 0.95,
      issues: [],
      previewUrl: "https://cdn.example.com/preview",
    });

    await processor(makeJob(data));

    expect(buildPage).toHaveBeenCalledWith({
      db: fastify.db,
      queues: fastify.queues,
      config: fastify.config,
      workspaceUuid: data.workspaceUuid,
      siteUuid: data.siteUuid,
      pageSlug: data.pageSlug,
      aiJobUuid: data.aiJobUuid,
      attemptId: data.attemptId,
      mode: data.mode,
      referenceScreenshotUrl: data.referenceScreenshotUrl,
    });
  });

  test("works without optional mode and reference screenshot", async () => {
    const fastify = makeFastify();
    const processor = generatePageProcessor(fastify);

    const data = {
      workspaceUuid: "ws-2",
      siteUuid: "site-2",
      pageSlug: "about",
      aiJobUuid: "job-2",
      attemptId: "attempt-2",
    };

    buildPage.mockResolvedValueOnce({
      pageSlug: "about",
      passed: true,
      fidelityScore: 1,
      issues: [],
      previewUrl: "https://cdn.example.com/preview-about",
    });

    await processor(makeJob(data));

    expect(buildPage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSlug: "about",
        mode: undefined,
        referenceScreenshotUrl: undefined,
      }),
    );
  });
});
