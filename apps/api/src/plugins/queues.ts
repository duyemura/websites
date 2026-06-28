import fp from "fastify-plugin";
import bull from "../bullmq";

export default fp(
  (fastify, _, done) => {
    const aiGenerate = bull.build("ai-generate");
    const sitePublish = bull.build("site-publish");
    const siteReplicate = bull.build("site-replicate");
    const playbookRun = bull.build("playbook-run");

    fastify.decorate("queues", {
      aiGenerate,
      sitePublish,
      siteReplicate,
      playbookRun,
    });

    done();
  },
  { name: "queues", dependencies: ["env"] },
);

declare module "../bullmq" {
  export interface QueueConfig {
    "ai-generate": { data: { workspaceUuid: string; siteUuid?: string }; result: unknown };
    "site-publish": { data: { siteUuid: string; deploymentUuid: string }; result: unknown };
    "site-replicate": { data: { workspaceUuid: string; url: string }; result: unknown };
    "playbook-run": { data: { workspaceUuid: string; playbookUuid: string }; result: unknown };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    queues: {
      aiGenerate: ReturnType<typeof bull.build<"ai-generate">>;
      sitePublish: ReturnType<typeof bull.build<"site-publish">>;
      siteReplicate: ReturnType<typeof bull.build<"site-replicate">>;
      playbookRun: ReturnType<typeof bull.build<"playbook-run">>;
    };
  }
}
