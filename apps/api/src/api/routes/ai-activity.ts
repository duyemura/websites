import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { getRecentAiActivity, getAiActivityCostSummary } from "../../services/ai-activity";
import type { AiActivityAction, AiActivityOutcome } from "../../types/db";

const AiActivitySchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  siteUuid: z.string().nullable(),
  userUuid: z.string(),
  aiJobUuid: z.string().nullable(),
  actionType: z.string(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  promptTemplateKeys: z.string().nullable(),
  inputDocKeys: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  latencyMs: z.number().nullable(),
  outcome: z.string(),
  fidelityScore: z.number().nullable(),
  summary: z.string(),
  errorMessage: z.string().nullable(),
  userCorrection: z.string().nullable(),
  metadata: z.any().nullable(),
  createdAt: z.string(),
});

const AiActivityListQuerySchema = z.object({
  siteUuid: z.string().uuid().optional(),
  actionType: z.enum(["apply_suggestion", "edit", "generate", "memory_update", "publish", "qa", "replicate", "suggest"]).optional(),
  outcome: z.enum(["failure", "partial", "rejected", "success", "user_edited"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
});

const AiActivityListResponseSchema = z.object({
  activities: z.array(AiActivitySchema),
  summary: z.object({
    totalCostUsd: z.number(),
    totalTokens: z.number(),
    count: z.number(),
  }),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/ai-activity",
    {
      schema: {
        querystring: AiActivityListQuerySchema,
        response: { 200: AiActivityListResponseSchema },
      },
    },
    async (request) => {
      const workspaceUuid = request.workspace.uuid;
      const { siteUuid, actionType, outcome, limit } = request.query;

      const [activities, summary] = await Promise.all([
        getRecentAiActivity(fastify.db, {
          workspaceUuid,
          siteUuid,
          actionType: actionType as AiActivityAction | undefined,
          outcome: outcome as AiActivityOutcome | undefined,
          limit,
        }),
        getAiActivityCostSummary(fastify.db, workspaceUuid),
      ]);

      return {
        activities: activities.map((a) => ({
          ...a,
          costUsd: a.costUsd != null ? Number(a.costUsd) : null,
          fidelityScore: a.fidelityScore != null ? Number(a.fidelityScore) : null,
          createdAt: a.createdAt.toISOString(),
        })),
        summary,
      };
    },
  );

  done();
};

export default app;
