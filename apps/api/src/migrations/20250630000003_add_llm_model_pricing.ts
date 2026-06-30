import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("llm_model_pricing")
    .addColumn("uuid", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("inputPricePer1kTokens", "numeric", (col) => col.notNull())
    .addColumn("outputPricePer1kTokens", "numeric", (col) => col.notNull())
    .addColumn("currency", "text", (col) => col.notNull().defaultTo("USD"))
    .addColumn("effectiveFrom", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("effectiveUntil", "timestamptz")
    .addColumn("metadata", "jsonb")
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("llm_model_pricing_provider_model_effective_idx")
    .on("llm_model_pricing")
    .columns(["provider", "model", "effectiveFrom", "effectiveUntil"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("llm_model_pricing_provider_model_effective_idx")
    .execute();
  await db.schema.dropTable("llm_model_pricing").execute();
}
