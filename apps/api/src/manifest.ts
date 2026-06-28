import {
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyPluginOptions,
} from "fastify";
import { z } from "zod";
import Api from "./api";
import Worker from "./worker";

export const Service = z.enum(["api", "worker", "renderer", "monolith"]);
export type Service = z.infer<typeof Service>;

type FastifyPlugin = FastifyPluginAsync | FastifyPluginCallback;
type PluginConfig = [FastifyPlugin] | [FastifyPlugin, FastifyPluginOptions];

export type Manifest = Record<Service, PluginConfig[]>;

const api: PluginConfig = [Api];
const worker: PluginConfig = [Worker, { prefix: "worker" }];

const manifest: Manifest = {
  api: [api],
  worker: [worker],
  renderer: [],
  monolith: [api, worker],
};

export default manifest;
