import type { Kysely } from "kysely";
import type { DB, AiActivityAction, AiActivityOutcome } from "../types/db";
import { logAiActivity } from "../services/ai-activity";
import { getLlmPricing, calculateLlmCost, estimateLlmCostFromTotal } from "../services/llm-pricing";
import { chatCompletion, sanitizeRawResponse, type ChatMessage, type ChatResponse } from "./llm-client";
import { modelForAgent, type LlmTask } from "./model-picker";
import type { Config } from "../plugins/env";

export interface LlmCallContext {
  db: Kysely<DB>;
  workspaceUuid: string;
  userUuid: string;
  siteUuid?: string | null;
  aiJobUuid?: string | null;
}

export interface LlmCallParams {
  /** Agent name used to pick the model and label the activity. */
  agent: string;
  /** Optional task override if the agent name is not in AGENT_TASK_MAP. */
  task?: LlmTask;
  /** Activity classification. */
  actionType: AiActivityAction;
  /** Prompt/template keys for the activity record. */
  promptTemplateKeys: string[];
  /** Doc keys consumed by this call, if any. */
  inputDocKeys?: string[];
  /** Human-readable summary of what this call attempted. */
  summary: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /**
   * Optional post-call inspection. Return an outcome to override the default
   * HTTP-level outcome (e.g., mark a successful HTTP response as "partial"
   * when the JSON does not match the expected schema).
   */
  postCall?: (response: ChatResponse) =>
    | { outcome: AiActivityOutcome; errorMessage?: string | null; summary?: string }
    | undefined
    | void;
}

export interface LlmCallResult {
  response: ChatResponse;
  outcome: AiActivityOutcome;
  errorMessage: string | null;
}

/**
 * Calls the LLM and logs the result to ai_activity.
 *
 * Logging is best-effort: any logging error is swallowed so the caller's
 * happy path is never interrupted.
 */
export async function callLlmAndLog(
  ctx: LlmCallContext,
  params: LlmCallParams,
  config: Config,
): Promise<LlmCallResult> {
  const model = params.task ? modelForTask(params.task, config) : modelForAgent(params.agent, config);
  const provider = config.LLM_PROVIDER;
  const start = Date.now();
  let httpOutcome: AiActivityOutcome = "failure";
  let httpError: string | null = null;
  let response: ChatResponse = { content: "" };

  try {
    response = await chatCompletion(
      {
        model,
        messages: params.messages,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        jsonMode: params.jsonMode,
      },
      config,
    );
    httpOutcome = "success";
  } catch (err) {
    httpOutcome = "failure";
    httpError = err instanceof Error ? err.message : String(err);
  }

  const post = params.postCall?.(response);
  const outcome = post?.outcome ?? httpOutcome;
  const summary = post?.summary ?? params.summary;
  const errorMessage = outcome === "success" ? null : (post?.errorMessage ?? httpError);
  const promptTokens = response.usage?.promptTokens ?? null;
  const completionTokens = response.usage?.completionTokens ?? null;
  const totalTokens = response.usage?.totalTokens ?? null;
  const latencyMs = response.latencyMs ?? Math.round(Date.now() - start);

  try {
    const pricing = await getLlmPricing(ctx.db, provider, model);
    let costUsd: number | null = null;
    if (pricing) {
      if (promptTokens != null && completionTokens != null) {
        costUsd = calculateLlmCost(pricing, promptTokens, completionTokens);
      } else if (totalTokens != null) {
        costUsd = estimateLlmCostFromTotal(pricing, totalTokens);
      }
    }

    await logAiActivity(ctx.db, {
      workspaceUuid: ctx.workspaceUuid,
      userUuid: ctx.userUuid,
      siteUuid: ctx.siteUuid ?? null,
      aiJobUuid: ctx.aiJobUuid ?? null,
      actionType: params.actionType,
      model,
      provider,
      promptTemplateKeys: params.promptTemplateKeys,
      inputDocKeys: params.inputDocKeys,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      costUsd,
      latencyMs,
      outcome,
      summary,
      errorMessage,
      metadata: {
        agent: params.agent,
        totalTokens,
        responseMetadata: sanitizeRawResponse(response.raw ?? undefined),
      },
    });
  } catch {
    // Swallow logging errors.
  }

  return { response, outcome, errorMessage };
}
