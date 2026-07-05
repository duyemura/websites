import fp from "fastify-plugin";
import bull from "../bullmq";

export default fp(
  (fastify, _, done) => {
    const classifyAssets = bull.build("classify_assets");
    const unclassifiedAssets = bull.build("unclassified_assets");
    const generatePage = bull.build("generate_page");
    const generateAssets = bull.build("generate_assets");
    const replicateSite = bull.build("replicate_site");
    const sitePublish = bull.build("site_publish");
    const playbookRun = bull.build("playbook_run");
    const pipeline = bull.build("pipeline");
    const mirrorSite = bull.build("mirror_site");
    const goLiveSite = bull.build("go_live_site");

    fastify.decorate("queues", {
      classifyAssets,
      unclassifiedAssets,
      generatePage,
      generateAssets,
      replicateSite,
      sitePublish,
      playbookRun,
      pipeline,
      mirrorSite,
      goLiveSite,
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
    replicate_site: {
      data: { workspaceUuid: string; siteUuid: string; url: string; aiJobUuid: string };
      result: { aiJobUuid: string; attemptId: string; status: string };
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
    pipeline: {
      data:
        | {
            kind: "stage";
            stage: "extract" | "segment" | "docgen" | "build" | "verify";
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
        | {
            kind: "run";
            siteUuid: string;
            workspaceUuid: string;
            input: {
              url: string;
              pages?: string[];
              maxPages?: number;
              mode?: "replication" | "template" | "greenfield";
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
      replicateSite: ReturnType<typeof bull.build<"replicate_site">>;
      sitePublish: ReturnType<typeof bull.build<"site_publish">>;
      playbookRun: ReturnType<typeof bull.build<"playbook_run">>;
      pipeline: ReturnType<typeof bull.build<"pipeline">>;
      mirrorSite: ReturnType<typeof bull.build<"mirror_site">>;
      goLiveSite: ReturnType<typeof bull.build<"go_live_site">>;
    };
  }
}
