import fp from "fastify-plugin";
import type { FastifyPluginCallback } from "fastify";
import { classifyAssetsProcessor } from "../workers/classify-assets";
import { unclassifiedAssetsProcessor } from "../workers/unclassified-assets";
import { generatePageProcessor } from "../workers/generate-page";
import { generateAssetsProcessor } from "../workers/generate-assets";
import { sitePublishProcessor } from "../workers/site-publish";
import { playbookRunProcessor } from "../workers/playbook-run";
import { pipelineProcessor } from "../workers/pipeline";
import { mirrorSiteProcessor } from "../workers/mirror-site";
import { goLiveSiteProcessor } from "../workers/go-live-site";
import { siteEvalProcessor } from "../workers/site-eval";

const registerWorkers: FastifyPluginCallback = (fastify, _, done) => {
  fastify.queues.classifyAssets.worker.run(classifyAssetsProcessor(fastify));
  fastify.queues.unclassifiedAssets.worker.run(unclassifiedAssetsProcessor(fastify));
  fastify.queues.generatePage.worker.run(generatePageProcessor(fastify));
  fastify.queues.generateAssets.worker.run(generateAssetsProcessor(fastify));
  fastify.queues.sitePublish.worker.run(sitePublishProcessor(fastify));
  fastify.queues.playbookRun.worker.run(playbookRunProcessor(fastify));
  // Pipeline stages each own a browser — leave concurrency at the bullmq
  // default of 1 to avoid multiple concurrent chromium instances.
  fastify.queues.pipeline.worker.run(pipelineProcessor(fastify));
  fastify.queues.mirrorSite.worker.run(mirrorSiteProcessor(fastify));
  fastify.queues.goLiveSite.worker.run(goLiveSiteProcessor(fastify));
  fastify.queues.siteEval.worker.run(siteEvalProcessor(fastify));

  done();
};

export default fp(registerWorkers, {
  name: "register-workers",
  dependencies: ["queues"],
});
