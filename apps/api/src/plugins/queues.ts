import fp from "fastify-plugin";
import bull from "../bullmq";

export default fp(
  (fastify, _, done) => {
    const generatePage = bull.build("generate_page");
    const generateAssets = bull.build("generate_assets");
    const replicateSite = bull.build("replicate_site");
    const sitePublish = bull.build("site_publish");
    const playbookRun = bull.build("playbook_run");

    fastify.decorate("queues", {
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
      generatePage: ReturnType<typeof bull.build<"generate_page">>;
      generateAssets: ReturnType<typeof bull.build<"generate_assets">>;
      replicateSite: ReturnType<typeof bull.build<"replicate_site">>;
      sitePublish: ReturnType<typeof bull.build<"site_publish">>;
      playbookRun: ReturnType<typeof bull.build<"playbook_run">>;
    };
  }
}
