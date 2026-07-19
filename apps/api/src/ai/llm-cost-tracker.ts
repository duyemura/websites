/**
 * LLM cost tracking — accumulates token usage across all chatCompletion calls
 * within a pipeline stage and calculates estimated cost by model.
 *
 * Usage: chatCompletion() calls track() automatically. Stage runners call
 * getAndReset() at the end of their run to get per-stage LLM costs.
 */

// ── Per-model pricing (USD per 1M tokens) ────────────────────────────────────
// Update when model pricing changes. All figures are approximate list prices;
// actual costs depend on your contract / provider tier.

interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Array<{ pattern: RegExp; price: ModelPrice }> = [
  // Google Gemini
  { pattern: /gemini-2\.5-flash/i,       price: { inputPer1M: 0.075,  outputPer1M: 0.30  } },
  { pattern: /gemini-2\.5-pro/i,         price: { inputPer1M: 1.25,   outputPer1M: 10.00 } },
  { pattern: /gemini-2\.0-flash/i,       price: { inputPer1M: 0.10,   outputPer1M: 0.40  } },
  { pattern: /gemini-1\.5-flash/i,       price: { inputPer1M: 0.075,  outputPer1M: 0.30  } },
  { pattern: /gemini-1\.5-pro/i,         price: { inputPer1M: 3.50,   outputPer1M: 10.50 } },
  // Anthropic Claude
  { pattern: /claude-opus-4/i,           price: { inputPer1M: 15.00,  outputPer1M: 75.00 } },
  { pattern: /claude-sonnet-4/i,         price: { inputPer1M: 3.00,   outputPer1M: 15.00 } },
  { pattern: /claude-haiku-4/i,          price: { inputPer1M: 0.80,   outputPer1M: 4.00  } },
  { pattern: /claude-3-5-sonnet/i,       price: { inputPer1M: 3.00,   outputPer1M: 15.00 } },
  { pattern: /claude-3-5-haiku/i,        price: { inputPer1M: 0.80,   outputPer1M: 4.00  } },
  { pattern: /claude-3-opus/i,           price: { inputPer1M: 15.00,  outputPer1M: 75.00 } },
  // OpenAI
  { pattern: /gpt-4o-mini/i,            price: { inputPer1M: 0.15,   outputPer1M: 0.60  } },
  { pattern: /gpt-4o/i,                  price: { inputPer1M: 2.50,   outputPer1M: 10.00 } },
  { pattern: /gpt-4-turbo/i,             price: { inputPer1M: 10.00,  outputPer1M: 30.00 } },
  { pattern: /o1-mini/i,                 price: { inputPer1M: 3.00,   outputPer1M: 12.00 } },
  { pattern: /o1/i,                      price: { inputPer1M: 15.00,  outputPer1M: 60.00 } },
  // Mistral
  { pattern: /mistral-small/i,           price: { inputPer1M: 0.20,   outputPer1M: 0.60  } },
  { pattern: /mistral-large/i,           price: { inputPer1M: 2.00,   outputPer1M: 6.00  } },
];

const DEFAULT_PRICE: ModelPrice = { inputPer1M: 1.00, outputPer1M: 4.00 };

export function priceForModel(modelName: string): ModelPrice {
  for (const { pattern, price } of MODEL_PRICING) {
    if (pattern.test(modelName)) return price;
  }
  return DEFAULT_PRICE;
}

export function tokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const price = priceForModel(model);
  return (inputTokens / 1_000_000) * price.inputPer1M +
         (outputTokens / 1_000_000) * price.outputPer1M;
}

// ── Module-level accumulator ─────────────────────────────────────────────────

export interface LlmUsageSummary {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estimatedUsd: number;
  /** Per-model breakdown */
  byModel: Record<string, { inputTokens: number; outputTokens: number; calls: number; estimatedUsd: number }>;
}

class LlmCostAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private calls = 0;
  private estimatedUsd = 0;
  private byModel: Record<string, { inputTokens: number; outputTokens: number; calls: number; estimatedUsd: number }> = {};

  track(promptTokens: number | undefined, completionTokens: number | undefined, model: string): void {
    const inp = promptTokens ?? 0;
    const out = completionTokens ?? 0;
    if (inp === 0 && out === 0) return;

    const usd = tokenCostUsd(inp, out, model);
    this.inputTokens += inp;
    this.outputTokens += out;
    this.calls++;
    this.estimatedUsd += usd;

    const key = model;
    const entry = this.byModel[key] ?? { inputTokens: 0, outputTokens: 0, calls: 0, estimatedUsd: 0 };
    this.byModel[key] = {
      inputTokens: entry.inputTokens + inp,
      outputTokens: entry.outputTokens + out,
      calls: entry.calls + 1,
      estimatedUsd: entry.estimatedUsd + usd,
    };
  }

  /** Read current totals and reset the accumulator for the next stage. */
  getAndReset(): LlmUsageSummary {
    const summary: LlmUsageSummary = {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      calls: this.calls,
      estimatedUsd: this.estimatedUsd,
      byModel: { ...this.byModel },
    };
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.calls = 0;
    this.estimatedUsd = 0;
    this.byModel = {};
    return summary;
  }

  peek(): LlmUsageSummary {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      calls: this.calls,
      estimatedUsd: this.estimatedUsd,
      byModel: { ...this.byModel },
    };
  }
}

/** Singleton accumulator shared across all chatCompletion calls in this process. */
export const llmCostAccumulator = new LlmCostAccumulator();
