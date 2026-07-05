import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";
import { getS3Client } from "../../s3";
import { REBUILD_STAGES, type RebuildStage } from "../../types/pipeline-artifacts";
import { saveArtifact } from "../../utils/pipeline/artifact-store";
import { saveSiteDocs } from "../../utils/site-docs";

interface StageJobPayload {
  kind: "stage";
  stage: RebuildStage;
  siteUuid: string;
  workspaceUuid: string;
  input: {
    url?: string;
    pages?: string[];
    maxPages?: number;
    contentSiteUuid?: string;
    designSiteUuid?: string;
    mode?: "replication" | "template" | "greenfield";
  };
}

interface RunJobPayload {
  kind: "run";
  siteUuid: string;
  workspaceUuid: string;
  input: {
    url: string;
    pages?: string[];
    maxPages?: number;
    mode?: "replication" | "template" | "greenfield";
  };
}

type PipelineJobPayload = QueueConfig["pipeline"]["data"];

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
      const result = await runBuildStage({
        db: fastify.db,
        config: fastify.config,
        s3,
        siteUuid: job.siteUuid,
        workspaceUuid: job.workspaceUuid,
        pages: job.input.pages,
        runAstroBuild: true,
      });
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
        ? { url: job.input.url, pages: job.input.pages, maxPages: job.input.maxPages }
        : { pages: job.input.pages, mode: job.input.mode };
    results[stage] = await runStage(fastify, {
      kind: "stage",
      stage,
      siteUuid: job.siteUuid,
      workspaceUuid: job.workspaceUuid,
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

    let result: unknown;
    if (job.data.kind === "stage") {
      result = await runStage(fastify, job.data);
    } else {
      result = await runPipeline(fastify, job.data);
    }

    fastify.log.info(
      { jobId: job.id, kind: job.data.kind },
      "Pipeline worker finished",
    );
    return result;
  };
}
