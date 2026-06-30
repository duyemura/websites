import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Approximate placeholder pricing for the Ollama cloud-backed models used during PoC.
  // Update these rows (or add new effective-from rows) once real provider invoices are available.
  await db
    .insertInto("llmModelPricing" as never)
    .values([
      {
        provider: "ollama",
        model: "gemma4:31b-cloud",
        inputPricePer1kTokens: sql`0.0005`,
        outputPricePer1kTokens: sql`0.0015`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "gemma4:26b",
        inputPricePer1kTokens: sql`0.0004`,
        outputPricePer1kTokens: sql`0.0012`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "qwen3.5:397b-cloud",
        inputPricePer1kTokens: sql`0.001`,
        outputPricePer1kTokens: sql`0.003`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "qwen3.6:35b-a3b-nvfp4",
        inputPricePer1kTokens: sql`0.0003`,
        outputPricePer1kTokens: sql`0.0009`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "qwen3.5:7b",
        inputPricePer1kTokens: sql`0.0001`,
        outputPricePer1kTokens: sql`0.0003`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "qwen2.5-coder:32b",
        inputPricePer1kTokens: sql`0.0003`,
        outputPricePer1kTokens: sql`0.0009`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "llama4:scout",
        inputPricePer1kTokens: sql`0.0005`,
        outputPricePer1kTokens: sql`0.0015`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "deepseek-r1:32b",
        inputPricePer1kTokens: sql`0.0004`,
        outputPricePer1kTokens: sql`0.0012`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM llm_model_pricing WHERE provider = 'ollama'`.execute(db);
}
