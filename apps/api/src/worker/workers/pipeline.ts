import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";
import { getS3Client } from "../../s3";
import { connection } from "../../redis";
import { REBUILD_STAGES, type RebuildStage } from "../../types/pipeline-artifacts";
import { saveArtifact } from "../../utils/pipeline/artifact-store";
import { saveSiteDocs } from "../../utils/site-docs";
import { publishEvent, type SiteEvent } from "../../services/events.js";

interface StageJobPayload {
  kind: "stage";
  stage: RebuildStage;
  siteUuid: string;
  workspaceUuid: string;
  id?: string;
  input: {
    url?: string;
    pages?: string[];
    maxPages?: number;
    contentSiteUuid?: string;
    designSiteUuid?: string;
    mode?: "replication" | "template" | "greenfield";
    tier?: "free" | "paid";
  };
}

interface RunJobPayload {
  kind: "run";
  siteUuid: string;
  workspaceUuid: string;
  id?: string;
  input: {
    url: string;
    pages?: string[];
    maxPages?: number;
    mode?: "replication" | "template" | "greenfield";
    tier?: "free" | "paid";
  };
}

type PipelineJobPayload = QueueConfig["pipeline"]["data"];

function emitPipelineEvent(
  fastify: FastifyInstance,
  event: Omit<SiteEvent, "timestamp">,
): void {
  const redis = connection();
  void publishEvent(redis, {
    ...event,
    timestamp: new Date().toISOString(),
  }).catch((err) => {
    fastify.log.warn({ err, event }, "Failed to publish pipeline event");
  });
}

async function runStage(
  fastify: FastifyInstance,
  job: StageJobPayload,
): Promise<unknown> {
  const s3 = getS3Client({
    endpoint: fastify.config.S3_ENDPOINT,
    region: fastify.config.S3_REGION,
    accessKeyId: fastify.config.S3_ACCESS_KEY,
    secretAccessKey: fastify.config.S3_SECRET_KEY,
    sessionToken: fastify.config.S3_SESSION_TOKEN,
  });

  const ctx = { siteUuid: job.siteUuid, workspaceUuid: job.workspaceUuid };

  emitPipelineEvent(fastify, {
    type: "pipeline.stage.started",
    workspaceUuid: job.workspaceUuid,
    siteUuid: job.siteUuid,
    jobId: job.id?.toString() ?? null,
    payload: { stage: job.stage },
  });

  try {
    const result = await executeStage(fastify, job, s3, ctx);

    emitPipelineEvent(fastify, {
      type: "pipeline.stage.completed",
      workspaceUuid: job.workspaceUuid,
      siteUuid: job.siteUuid,
      jobId: job.id?.toString() ?? null,
      payload: { stage: job.stage },
    });

    return result;
  } catch (err) {
    emitPipelineEvent(fastify, {
      type: "pipeline.stage.failed",
      workspaceUuid: job.workspaceUuid,
      siteUuid: job.siteUuid,
      jobId: job.id?.toString() ?? null,
      payload: {
        stage: job.stage,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

async function executeStage(
  fastify: FastifyInstance,
  job: StageJobPayload,
  s3: ReturnType<typeof getS3Client>,
  ctx: { siteUuid: string; workspaceUuid: string },
): Promise<unknown> {
  switch (job.stage) {
    case "extract": {
      if (!job.input.url) {
        throw new Error(
          "extract stage requires a `url` input on the first run",
        );
      }
      const { runExtractStage } = await import(
        "../../services/pipeline/extract-stage.js"
      );
      return runExtractStage({
        db: fastify.db,
        config: fastify.config,
        s3,
        siteUuid: job.siteUuid,
        workspaceUuid: job.workspaceUuid,
        url: job.input.url,
        pages: job.input.pages,
        maxPages: job.input.maxPages,
        tier: job.input.tier,
      });
    }
    case "segment": {
      const { runSegmentStage } = await import(
        "../../services/pipeline/segment-stage.js"
      );
      return runSegmentStage({
        db: fastify.db,
        config: fastify.config,
        s3,
        siteUuid: job.siteUuid,
        workspaceUuid: job.workspaceUuid,
        pages: job.input.pages,
      });
    }
    case "contract": {
      const { runContractStage } = await import(
        "../../services/pipeline/contract-stage.js"
      );
      return runContractStage({
        db: fastify.db,
        config: fastify.config,
        s3,
        siteUuid: job.siteUuid,
        workspaceUuid: job.workspaceUuid,
        pages: job.input.pages,
      });
    }
    case "docgen": {
      const { runDocgenStage } = await import(
        "../../services/pipeline/docgen-stage.js"
      );
      const docs = await runDocgenStage({
        db: fastify.db,
        config: fastify.config,
        s3,
        siteUuid: job.siteUuid,
        workspaceUuid: job.workspaceUuid,
        mode: job.input.mode ?? "replication",
        contentSiteUuid: job.input.contentSiteUuid,
        designSiteUuid: job.input.designSiteUuid,
      });
      // Persist the docs to the docs table so the build stage can load them.
      await saveSiteDocs(fastify.db, job.workspaceUuid, docs, job.siteUuid);
      // Also persist a marker artifact so pipeline/status can report a version.
      await saveArtifact(fastify.db, ctx, "docgen", {
        docCount: docs.length,
        docKeys: docs.map((d) => d.key),
      });
      return docs;
    }
    case "build": {
      const { runBuildStage } = await import(
        "../../services/pipeline/build-stage.js"
      );

      // Batch subprocess log lines so we do not flood Redis with a publish per line.
      type LogLine = { stream: "stdout" | "stderr"; line: string; at: string };
      const logBatch: LogLine[] = [];
      let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
      function flushLogBatch() {
        if (logBatch.length === 0) return;
        const lines = logBatch.splice(0, logBatch.length);
        emitPipelineEvent(fastify, {
          type: "pipeline.stage.log",
          workspaceUuid: job.workspaceUuid,
          siteUuid: job.siteUuid,
          jobId: job.id?.toString() ?? null,
          payload: { stage: "build", lines },
        });
      }
      function scheduleLogFlush() {
        if (logFlushTimer) return;
        logFlushTimer = setTimeout(() => {
          logFlushTimer = null;
          flushLogBatch();
        }, 250);
      }

      const result = await runBuildStage({
        db: fastify.db,
        config: fastify.config,
        s3,
        siteUuid: job.siteUuid,
        workspaceUuid: job.workspaceUuid,
        pages: job.input.pages,
        runAstroBuild: true,
        onProgress: (progress) =>
          emitPipelineEvent(fastify, {
            type: "pipeline.stage.progress",
            workspaceUuid: job.workspaceUuid,
            siteUuid: job.siteUuid,
            jobId: job.id?.toString() ?? null,
            payload: progress,
          }),
        onLogLine: (line, stream) => {
          logBatch.push({ stream, line, at: new Date().toISOString() });
          scheduleLogFlush();
        },
      });

      if (logFlushTimer) {
        clearTimeout(logFlushTimer);
        logFlushTimer = null;
      }
      flushLogBatch();
      return result;
    }
    case "verify": {
      const { runVerifyStage } = await import(
        "../../services/pipeline/verify-stage.js"
      );
      const artifact = await runVerifyStage({
        db: fastify.db,
        config: fastify.config,
        s3,
        siteUuid: job.siteUuid,
        workspaceUuid: job.workspaceUuid,
        pages: job.input.pages,
      });
      // runVerifyStage persists the artifact itself; no need to double-save.
      return artifact;
    }
    default: {
      const _exhaustive: never = job.stage;
      throw new Error(`Unknown pipeline stage: ${String(_exhaustive)}`);
    }
  }
}

async function runPipeline(
  fastify: FastifyInstance,
  job: RunJobPayload,
): Promise<unknown> {
  const stages: typeof REBUILD_STAGES[number][] = [
    "extract",
    "segment",
    "contract",
    "docgen",
    "build",
    "verify",
  ];
  const results: Record<string, unknown> = {};
  for (const stage of stages) {
    // Only the first (extract) stage needs the url; downstream stages read
    // from the artifact store. Everything is scoped by the same site + workspace.
    const stageInput =
      stage === "extract"
        ? { url: job.input.url, pages: job.input.pages, maxPages: job.input.maxPages, tier: job.input.tier }
        : { pages: job.input.pages, mode: job.input.mode };
    results[stage] = await runStage(fastify, {
      kind: "stage",
      stage,
      siteUuid: job.siteUuid,
      workspaceUuid: job.workspaceUuid,
      id: job.id,
      input: stageInput,
    });
  }
  return results;
}

export function pipelineProcessor(fastify: FastifyInstance) {
  return async (job: Job<PipelineJobPayload>): Promise<unknown> => {
    fastify.log.info(
      { jobId: job.id, kind: job.data.kind },
      "Pipeline worker started",
    );

    const basePayload = {
      workspaceUuid: job.data.workspaceUuid,
      siteUuid: job.data.siteUuid,
      jobId: job.id?.toString() ?? null,
    };

    emitPipelineEvent(fastify, {
      type: "pipeline.job.started",
      ...basePayload,
      payload: {
        kind: job.data.kind,
        stages: job.data.kind === "run" ? REBUILD_STAGES : [job.data.stage],
        url: job.data.input.url,
      },
    });

    let result: unknown;
    try {
      if (job.data.kind === "stage") {
        result = await runStage(fastify, { ...job.data, id: job.id?.toString() });
      } else {
        result = await runPipeline(fastify, { ...job.data, id: job.id?.toString() });
      }

      fastify.log.info(
        { jobId: job.id, kind: job.data.kind },
        "Pipeline worker finished",
      );

      emitPipelineEvent(fastify, {
        type: "pipeline.job.completed",
        ...basePayload,
        payload: { kind: job.data.kind },
      });

      return result;
    } catch (err) {
      fastify.log.error(
        { jobId: job.id, kind: job.data.kind, err },
        "Pipeline worker failed",
      );

      emitPipelineEvent(fastify, {
        type: "pipeline.job.failed",
        ...basePayload,
        payload: {
          kind: job.data.kind,
          error: err instanceof Error ? err.message : String(err),
        },
      });

      throw err;
    }
  };
}
