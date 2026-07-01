import type { FastifyInstance } from "fastify";
import type { Selectable } from "kysely";
import type { DB } from "../../types/db";
import type { SiteBlueprint } from "../../utils/site-blueprint";

export interface AssistantContext {
  db: FastifyInstance["db"];
  queues: FastifyInstance["queues"];
  config: FastifyInstance["config"];
  workspaceUuid: string;
  siteUuid: string;
  userUuid: string;
  site: Selectable<DB["sites"]>;
  deployment: Selectable<DB["deployments"]> | null;
  blueprint: SiteBlueprint | null;
}

export interface ActionResult {
  reply: string;
  action: string;
  enqueued: boolean;
  messages?: { role: "assistant" | "user"; content: string }[];
}

export interface BuildAssistantAction {
  name: string;
  canHandle(message: string, ctx: AssistantContext): boolean | Promise<boolean>;
  execute(message: string, ctx: AssistantContext): Promise<ActionResult>;
}
