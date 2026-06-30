import fp from "fastify-plugin";
import type { FastifyPluginCallback } from "fastify";
import { replicateSiteProcessor } from "../workers/replicate-site";
import { generatePageProcessor } from "../workers/generate-page";
import { generateAssetsProcessor } from "../workers/generate-assets";
import { sitePublishProcessor } from "../workers/site-publish";
import { playbookRunProcessor } from "../workers/playbook-run";

const registerWorkers: FastifyPluginCallback = (fastify, _, done) => {
  fastify.queues.replicateSite.worker.run(replicateSiteProcessor(fastify));
  fastify.queues.generatePage.worker.run(generatePageProcessor(fastify));
  fastify.queues.generateAssets.worker.run(generateAssetsProcessor(fastify));
  fastify.queues.sitePublish.worker.run(sitePublishProcessor(fastify));
  fastify.queues.playbookRun.worker.run(playbookRunProcessor(fastify));

  done();
};

export default fp(registerWorkers, {
  name: "register-workers",
  dependencies: ["queues"],
});
