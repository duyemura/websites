import type { Kysely } from "kysely";
import type { DB } from "../types/db";

export interface LlmPricing {
  provider: string;
  model: string;
  inputPricePer1kTokens: number;
  outputPricePer1kTokens: number;
  currency: string;
}

export async function getLlmPricing(
  db: Kysely<DB>,
  provider: string,
  model: string,
): Promise<LlmPricing | null> {
  const now = new Date();
  const row = await db
    .selectFrom("llmModelPricing")
    .select([
      "provider",
      "model",
      "inputPricePer1kTokens",
      "outputPricePer1kTokens",
      "currency",
    ])
    .where("provider", "=", provider)
    .where("model", "=", model)
    .where("effectiveFrom", "<=", now)
    .where((eb) =>
      eb.or([
        eb("effectiveUntil", "is", null),
        eb("effectiveUntil", ">", now),
      ]),
    )
    .orderBy("effectiveFrom", "desc")
    .executeTakeFirst();

  if (!row) return null;

  return {
    provider: row.provider,
    model: row.model,
    inputPricePer1kTokens: Number(row.inputPricePer1kTokens),
    outputPricePer1kTokens: Number(row.outputPricePer1kTokens),
    currency: row.currency,
  };
}

export function calculateLlmCost(
  pricing: LlmPricing,
  inputTokens: number,
  outputTokens: number,
): number {
  const inputCost = (inputTokens / 1000) * pricing.inputPricePer1kTokens;
  const outputCost = (outputTokens / 1000) * pricing.outputPricePer1kTokens;
  return Number((inputCost + outputCost).toFixed(6));
}

export function estimateLlmCostFromTotal(
  pricing: LlmPricing,
  totalTokens: number,
): number {
  // Fallback cost estimate when providers only return total_tokens.
  // Uses the average of input/output rates; accurate enough for cost dashboards.
  const avgPricePer1kTokens =
    (pricing.inputPricePer1kTokens + pricing.outputPricePer1kTokens) / 2;
  return Number(((totalTokens / 1000) * avgPricePer1kTokens).toFixed(6));
}
