import "zod-openapi/extend";

import { join } from "node:path";
import { AutoloadPluginOptions } from "@fastify/autoload";
import {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyServerOptions,
} from "fastify";
import Manifest, { Service } from "./manifest";
import { serializerCompiler, validatorCompiler } from "fastify-zod-openapi";
import qs from "qs";
import AutoLoad from "@fastify/autoload";
import EventEmitter from "eventemitter2";
import { repl } from "./repl";
import fp from "fastify-plugin";
import { connection } from "./redis";
import envPlugin from "./plugins/env";

export const internalEventEmitter = new EventEmitter();

export interface AppOptions
  extends FastifyServerOptions,
    Partial<AutoloadPluginOptions> {
  service?: Service;
  repl?: boolean;
}

const options: AppOptions = {
  ignoreTrailingSlash: true,
  querystringParser: qs.parse,
  repl: false,
  pluginTimeout: 120000,
};

const app: FastifyPluginAsync<AppOptions> = async (fastify, options) => {
  const service = options.service ?? Service.parse(process.env.SERVICE);

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Load env first so plugin dependencies are satisfied.
  await fastify.register(envPlugin);

  await fastify.register(AutoLoad, {
    dir: join(__dirname, "plugins"),
    options: options,
    ignoreFilter: /env\.(ts|js)$/,
  });

  await fastify.register(AutoLoad, {
    dir: join(__dirname, "routes"),
    options: options,
  });

  fastify.addHook("onClose", async () => {
    await internalEventEmitter.emitAsync("close");
    await fastify.db.destroy();
    await connection().quit();
  });

  if (options.repl) {
    await mountServices(Manifest, fastify, {
      encapsulate: false,
      service,
    });
    repl(service, fastify);
    return;
  }

  await mountServices(Manifest, fastify, {
    encapsulate: true,
    service,
  });
};

export default app;
export { app, options };

async function mountServices(
  manifest: typeof Manifest,
  fastify: FastifyInstance,
  { encapsulate, service }: { encapsulate: boolean; service: Service },
) {
  await Promise.all(
    manifest[service].map(([plugin, opts]) =>
      fastify.register(encapsulate ? plugin : fp(plugin), opts ?? {}),
    ),
  );
}
