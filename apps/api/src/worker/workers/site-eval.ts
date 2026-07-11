import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import { getS3Client } from "../../s3";
import { evaluatePage } from "../../services/eval/page-evaluator.js";
import type { PageEvalReport } from "../../services/eval/page-eval-report.js";
import type { QueueConfig } from "../../bullmq";

export interface EvalJobResult {
  status: "passed" | "failed";
  report: PageEvalReport;
  failedReason?: string;
}

export function siteEvalProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["site_eval"]["data"]>): Promise<EvalJobResult> => {
    const { siteUuid, workspaceUuid, evalUuid, path, url, keywords } = job.data;
    fastify.log.info({ jobId: job.id, siteUuid, evalUuid, path }, "site-eval worker started");

    const config = fastify.config;
    const s3Client = getS3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
      sessionToken: config.S3_SESSION_TOKEN,
    });

    await fastify.db
      .updateTable("siteEvals")
      .set({ status: "running", updatedAt: new Date().toISOString() })
      .where("uuid", "=", evalUuid)
      .execute();

    try {
      const report = await evaluatePage({
        db: fastify.db,
        config,
        s3Client,
        siteUuid,
        workspaceUuid,
        path: path ?? "/",
        url,
        keywords,
        log: (msg) => fastify.log.info({ siteUuid, evalUuid, path }, msg),
      });

      const totalIssues = report.categories.flatMap((c) => c.issues).length;
      const criticalIssues = report.categories
        .flatMap((c) => c.issues)
        .filter((i) => i.severity === "critical").length;

      await fastify.db
        .updateTable("siteEvals")
        .set({
          status: report.overall.status === "passed" ? "passed" : "failed",
          avgSimilarity: null,
          pageCount: 1,
          passCount: report.overall.status === "passed" ? 1 : 0,
          formStatus: `${report.overall.score}/100 ${report.overall.grade}`,
          warnings: JSON.stringify(report.categories.flatMap((c) => c.issues.map((i) => `[${c.name}] ${i.severity}: ${i.message}`))),
          pages: JSON.stringify([{
            path: report.metadata.path,
            score: report.overall.score,
            heightDeltaPx: 0,
          }]),
          report: JSON.stringify(report),
          failedReason: null,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where("uuid", "=", evalUuid)
        .execute();

      fastify.log.info(
        { jobId: job.id, siteUuid, evalUuid, path, score: report.overall.score, grade: report.overall.grade, totalIssues, criticalIssues },
        "site-eval worker finished",
      );

      return {
        status: report.overall.status === "passed" ? "passed" : "failed",
        report,
      };
    } catch (err) {
      const failedReason = err instanceof Error ? err.message : String(err);
      fastify.log.error({ jobId: job.id, siteUuid, evalUuid, path, err }, "site-eval worker failed");

      await fastify.db
        .updateTable("siteEvals")
        .set({
          status: "failed",
          failedReason,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where("uuid", "=", evalUuid)
        .execute();

      return {
        status: "failed",
        report: {
          overall: {
            score: 0,
            grade: "F",
            status: "failed",
            summary: failedReason,
            clientSummary: `The evaluator failed to run: ${failedReason}`,
            actionItems: [
              {
                priority: "critical",
                category: "content",
                message: failedReason,
                fix: "Check evaluator logs and re-run the eval.",
              },
            ],
          },
          categories: [],
          metadata: { url: url ?? "", path: path ?? "/", title: null, h1: null, wordCount: 0, loadTimeMs: 0 },
        },
        failedReason,
      };
    }
  };
}

export default fp(
  (fastify, _, done) => {
    fastify.queues.siteEval.worker.run(siteEvalProcessor(fastify));
    done();
  },
  { name: "site-eval-worker", dependencies: ["queues"] },
);
