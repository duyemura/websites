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

    fastify.decorate("queues", {
      classifyAssets,
      unclassifiedAssets,
      generatePage,
      generateAssets,
      replicateSite,
      sitePublish,
      playbookRun,
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
      };
      result: unknown;
    };
    generate_assets: {
      data: { workspaceUuid: string; siteUuid: string; assetJobUuid?: string };
      result: unknown;
    };
    replicate_site: {
      data: { workspaceUuid: string; siteUuid: string; url?: string };
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
    };
  }
}
