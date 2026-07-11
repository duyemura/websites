import fp from "fastify-plugin";
import bull from "../bullmq";
import type { PageEvalReport } from "../services/eval/page-eval-report.js";

export default fp(
  (fastify, _, done) => {
    const classifyAssets = bull.build("classify_assets");
    const unclassifiedAssets = bull.build("unclassified_assets");
    const generatePage = bull.build("generate_page");
    const generateAssets = bull.build("generate_assets");
    const sitePublish = bull.build("site_publish");
    const playbookRun = bull.build("playbook_run");
    const pipeline = bull.build("pipeline");
    const mirrorSite = bull.build("mirror_site");
    const goLiveSite = bull.build("go_live_site");
    const leadNotify = bull.build("lead_notify");
    const deployTemplate = bull.build("deploy_template");
    const siteEval = bull.build("site_eval");

    fastify.decorate("queues", {
      classifyAssets,
      unclassifiedAssets,
      generatePage,
      generateAssets,
      sitePublish,
      playbookRun,
      pipeline,
      mirrorSite,
      goLiveSite,
      leadNotify,
      deployTemplate,
      siteEval,
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
    generate_page: {
      data: {
        workspaceUuid: string;
        siteUuid: string;
        pageSlug: string;
        aiJobUuid: string;
        attemptId: string;
        mode?: "replication" | "template" | "greenfield";
        referenceScreenshotUrl?: string | null;
      };
      result: unknown;
    };
    generate_assets: {
      data: { workspaceUuid: string; siteUuid?: string | null; assetGenerationUuid: string; userUuid: string; assetJobUuid?: string };
      result: unknown;
    };
    site_publish: {
      data: { siteUuid: string; deploymentUuid: string };
      result: unknown;
    };
    playbook_run: {
      data: { workspaceUuid: string; playbookUuid: string; aiJobUuid?: string };
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
      };
      result: {
        status: "passed" | "failed";
        report: PageEvalReport;
        failedReason?: string;
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
      generatePage: ReturnType<typeof bull.build<"generate_page">>;
      generateAssets: ReturnType<typeof bull.build<"generate_assets">>;
      sitePublish: ReturnType<typeof bull.build<"site_publish">>;
      playbookRun: ReturnType<typeof bull.build<"playbook_run">>;
      pipeline: ReturnType<typeof bull.build<"pipeline">>;
      mirrorSite: ReturnType<typeof bull.build<"mirror_site">>;
      goLiveSite: ReturnType<typeof bull.build<"go_live_site">>;
      leadNotify: ReturnType<typeof bull.build<"lead_notify">>;
      deployTemplate: ReturnType<typeof bull.build<"deploy_template">>;
      siteEval: ReturnType<typeof bull.build<"site_eval">>;
    };
  }
}
