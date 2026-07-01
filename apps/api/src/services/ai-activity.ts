import type { Kysely } from "kysely";
import { jsonb } from "../utils/jsonb";
import type { DB, AiActivityAction, AiActivityOutcome } from "../types/db";

export interface LogAiActivityInput {
  workspaceUuid: string;
  userUuid: string;
  siteUuid?: string | null;
  aiJobUuid?: string | null;
  actionType: AiActivityAction;
  model?: string | null;
  provider?: string | null;
  promptTemplateKeys?: string[] | null;
  inputDocKeys?: string[] | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  outcome: AiActivityOutcome;
  fidelityScore?: number | null;
  summary: string;
  errorMessage?: string | null;
  userCorrection?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAiActivity(
  db: Kysely<DB>,
  input: LogAiActivityInput,
): Promise<string> {
  const row = await db
    .insertInto("aiActivity")
    .values({
      workspaceUuid: input.workspaceUuid,
      userUuid: input.userUuid,
      siteUuid: input.siteUuid ?? null,
      aiJobUuid: input.aiJobUuid ?? null,
      actionType: input.actionType,
      model: input.model ?? null,
      provider: input.provider ?? null,
      promptTemplateKeys: input.promptTemplateKeys?.join(",") ?? null,
      inputDocKeys: input.inputDocKeys?.join(",") ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      costUsd: input.costUsd ?? null,
      latencyMs: input.latencyMs ?? null,
      outcome: input.outcome,
      fidelityScore: input.fidelityScore ?? null,
      summary: input.summary,
      errorMessage: input.errorMessage ?? null,
      userCorrection: input.userCorrection ?? null,
      metadata: input.metadata ? jsonb(input.metadata) : null,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();

  return row.uuid;
}

export async function getRecentAiActivity(
  db: Kysely<DB>,
  filters: {
    workspaceUuid: string;
    siteUuid?: string;
    actionType?: AiActivityAction;
    outcome?: AiActivityOutcome;
    limit?: number;
  },
) {
  let query = db
    .selectFrom("aiActivity")
    .selectAll()
    .where("workspaceUuid", "=", filters.workspaceUuid)
    .orderBy("createdAt", "desc");

  if (filters.siteUuid) {
    query = query.where("siteUuid", "=", filters.siteUuid);
  }
  if (filters.actionType) {
    query = query.where("actionType", "=", filters.actionType);
  }
  if (filters.outcome) {
    query = query.where("outcome", "=", filters.outcome);
  }

  return query.limit(filters.limit ?? 50).execute();
}

interface AiActivityCostSummaryFilters {
  workspaceUuid: string;
  siteUuid?: string;
  actionType?: AiActivityAction;
  outcome?: AiActivityOutcome;
  excludeActionTypes?: AiActivityAction[];
}

export async function getAiActivityCostSummary(
  db: Kysely<DB>,
  filters: AiActivityCostSummaryFilters,
): Promise<{ totalCostUsd: number; totalTokens: number; count: number }> {
  let query = db
    .selectFrom("aiActivity")
    .where("workspaceUuid", "=", filters.workspaceUuid);

  if (filters.siteUuid) {
    query = query.where("siteUuid", "=", filters.siteUuid);
  }
  if (filters.actionType) {
    query = query.where("actionType", "=", filters.actionType);
  }
  if (filters.outcome) {
    query = query.where("outcome", "=", filters.outcome);
  }
  if (filters.excludeActionTypes?.length) {
    query = query.where(
      "actionType",
      "not in",
      filters.excludeActionTypes,
    );
  }

  const result = await query
    .select((eb) => [
      eb.fn.sum("costUsd").as("totalCostUsd"),
      eb.fn.sum(eb.fn.coalesce("inputTokens", eb.val(0))).as("inputTokens"),
      eb.fn.sum(eb.fn.coalesce("outputTokens", eb.val(0))).as("outputTokens"),
      eb.fn.count("uuid").as("count"),
    ])
    .executeTakeFirst();

  const inputTokens = Number(result?.inputTokens ?? 0);
  const outputTokens = Number(result?.outputTokens ?? 0);

  return {
    totalCostUsd: Number(result?.totalCostUsd ?? 0),
    totalTokens: inputTokens + outputTokens,
    count: Number(result?.count ?? 0),
  };
}
