import { FastifyPluginCallback } from "fastify";
import AutoLoad from "@fastify/autoload";
import { join } from "node:path";
import fs from "node:fs";

const app: FastifyPluginCallback = (fastify, opts, done) => {
  const pluginsDir = join(__dirname, "plugins");
  const workersDir = join(__dirname, "workers");

  if (fs.existsSync(pluginsDir)) {
    void fastify.register(AutoLoad, {
      dir: pluginsDir,
      options: { ...opts, prefix: "/worker" },
    });
  }

  if (fs.existsSync(workersDir)) {
    void fastify.register(AutoLoad, {
      dir: workersDir,
      options: opts,
      ignoreFilter: /__tests__\/|\/__tests__\.[tj]sx?$/,
    });
  }

  done();
};

export default app;
