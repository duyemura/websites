import { FastifyInstance } from "fastify";
import { Service } from "./manifest";

export function repl(_service: Service, _fastify: FastifyInstance) {
  // fastify-cli repl is started by the --repl flag
  // this file is a hook placeholder for future repl customizations
}
