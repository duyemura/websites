import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db
    .insertInto("llmModelPricing" as never)
    .values([
      {
        provider: "ollama",
        model: "kimi-k2.7-code:cloud",
        inputPricePer1kTokens: sql`0.0015`,
        outputPricePer1kTokens: sql`0.006`,
        currency: "USD",
        effectiveFrom: sql`now()`,
        metadata: {
          note: "Cloud-backed Ollama model; placeholder pricing until real invoice data is available.",
        },
      },
      {
        provider: "ollama",
        model: "kimi-k2.7-code",
        inputPricePer1kTokens: sql`0.0015`,
        outputPricePer1kTokens: sql`0.006`,
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
  await sql`DELETE FROM llm_model_pricing WHERE provider = 'ollama' AND model IN ('kimi-k2.7-code:cloud', 'kimi-k2.7-code')`.execute(
    db,
  );
}
