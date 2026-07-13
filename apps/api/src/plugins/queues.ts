import fp from "fastify-plugin";
import bull from "../bullmq";
import type { PageEvalReport } from "../services/eval/page-eval-report.js";
export default fp(
  (fastify, _, done) => {
    const classifyAssets = bull.build("classify_assets");
    const unclassifiedAssets = bull.build("unclassified_assets");
    const generateAssets = bull.build("generate_assets");
    const pipeline = bull.build("pipeline");
    const mirrorSite = bull.build("mirror_site");
    const goLiveSite = bull.build("go_live_site");
    const leadNotify = bull.build("lead_notify");
    const deployTemplate = bull.build("deploy_template");
    const siteEval = bull.build("site_eval");
    const evalFix = bull.build("eval_fix");

    fastify.decorate("queues", {
      classifyAssets,
      unclassifiedAssets,
      generateAssets,
      pipeline,
      mirrorSite,
      goLiveSite,
      leadNotify,
      deployTemplate,
      siteEval,
      evalFix,
    });

    done();
  },
  { name: "queues", dependencies: ["env"] },
);

declare module "../bullmq" {
  export interface QueueConfig {
    classify_assets: {
      data: {
        workspaceUuid: string;
        assetUuid: string;
        userUuid: string;
        siteUuid?: string;
        aiJobUuid?: string;
      };
      result: unknown;
    };
    unclassified_assets: {
      data: {
        workspaceUuid: string;
        assetUuid: string;
        userUuid: string;
        siteUuid?: string;
        aiJobUuid?: string;
        reason: string;
      };
      result: unknown;
    };
    generate_assets: {
      data: { workspaceUuid: string; siteUuid?: string | null; assetGenerationUuid: string; userUuid: string; assetJobUuid?: string };
      result: unknown;
    };
    mirror_site: {
      data: { siteUuid: string; workspaceUuid: string };
      result: { previewUrl: string; pageCount: number; warnings: string[] };
    };
    go_live_site: {
      data: { siteUuid: string; workspaceUuid: string };
      result: { status: string; siteUrl: string };
    };
    lead_notify: {
      data: { leadUuid: string; siteUuid: string };
      result: { sent: boolean };
    };
    deploy_template: {
      data: { siteUuid: string; workspaceUuid: string };
      result: { version: number; deployPrefix: string };
    };
    site_eval: {
      data: {
        siteUuid: string;
        workspaceUuid: string;
        evalUuid: string;
        path: string;
        url?: string;
        keywords?: string[];
        /** When true, enqueue eval_fix to heal and rebuild the page on failure. */
        autoFix?: boolean;
      };
      result: {
        status: "passed" | "failed";
        report: PageEvalReport;
        failedReason?: string;
      };
    };
    eval_fix: {
      data: {
        siteUuid: string;
        workspaceUuid: string;
        evalUuid: string;
        pageSlug: string;
        /** Number of heal/rebuild iterations remaining. Keep low to avoid runaway loops. */
        remainingAttempts?: number;
      };
      result: {
        fixed: boolean;
        pageSlug: string;
        appliedHeals: number;
        sectionInstructions: number;
        published: boolean;
        templateVersion?: number;
        publishedVersion?: number;
        reEvalStatus: "passed" | "failed";
        reEvalScore?: number;
        reEvalGrade?: string;
      };
    };
    pipeline: {
      data:
        | {
            kind: "stage";
            stage: "extract" | "segment" | "contract" | "docgen" | "build" | "verify";
            siteUuid: string;
            workspaceUuid: string;
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
        | {
            kind: "run";
            siteUuid: string;
            workspaceUuid: string;
            input: {
              url: string;
              pages?: string[];
              maxPages?: number;
              mode?: "replication" | "template" | "greenfield";
              tier?: "free" | "paid";
            };
          };
      result: unknown;
    };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    queues: {
      classifyAssets: ReturnType<typeof bull.build<"classify_assets">>;
      unclassifiedAssets: ReturnType<typeof bull.build<"unclassified_assets">>;
      generateAssets: ReturnType<typeof bull.build<"generate_assets">>;
      pipeline: ReturnType<typeof bull.build<"pipeline">>;
      mirrorSite: ReturnType<typeof bull.build<"mirror_site">>;
      goLiveSite: ReturnType<typeof bull.build<"go_live_site">>;
      leadNotify: ReturnType<typeof bull.build<"lead_notify">>;
      deployTemplate: ReturnType<typeof bull.build<"deploy_template">>;
      siteEval: ReturnType<typeof bull.build<"site_eval">>;
      evalFix: ReturnType<typeof bull.build<"eval_fix">>;
    };
  }
}
