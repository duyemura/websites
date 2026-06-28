import Fastify from "fastify";
import fp from "fastify-plugin";
import App, { AppOptions } from "../dist/app";
import { Service } from "../dist/manifest";
import { db } from "../src/database";

export async function build(opts?: AppOptions) {
  const service = opts?.service ?? Service.parse(process.env.SERVICE ?? "api");
  const fastify = Fastify({ logger: false });
  try {
    await fastify.register(fp(App), {
      ...opts,
      service,
    } as AppOptions);
    await fastify.ready();
  } catch (error) {
    console.error("Failed to build app:", error);
    throw error;
  }
  return fastify;
}

export function authHeaders() {
  return {
    authorization: "Bearer test-user",
    "x-workspace-slug": "test-workspace",
  };
}

export async function getTestWorkspaceUuid(): Promise<string> {
  const workspace = await db
    .selectFrom("workspaces")
    .select("uuid")
    .where("slug", "=", "test-workspace")
    .executeTakeFirstOrThrow();
  return workspace.uuid;
}
