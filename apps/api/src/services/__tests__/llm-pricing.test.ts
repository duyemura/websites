import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "../../database";
import { getLlmPricing, calculateLlmCost, estimateLlmCostFromTotal } from "../llm-pricing";

describe("llm-pricing service", () => {
  beforeEach(async () => {
    await db
      .insertInto("llmModelPricing")
      .values({
        provider: "test-provider",
        model: "test-model",
        inputPricePer1kTokens: 0.001,
        outputPricePer1kTokens: 0.003,
        currency: "USD",
        effectiveFrom: new Date("2026-01-01"),
      })
      .execute();
  });

  afterEach(async () => {
    await db
      .deleteFrom("llmModelPricing")
      .where("provider", "=", "test-provider")
      .where("model", "=", "test-model")
      .execute();
  });

  test("returns matching pricing row", async () => {
    const pricing = await getLlmPricing(db, "test-provider", "test-model");
    expect(pricing).not.toBeNull();
    expect(pricing?.inputPricePer1kTokens).toBe(0.001);
    expect(pricing?.outputPricePer1kTokens).toBe(0.003);
  });

  test("returns null when no pricing exists", async () => {
    const pricing = await getLlmPricing(db, "unknown-provider", "unknown-model");
    expect(pricing).toBeNull();
  });

  test("calculates cost from input and output tokens", () => {
    const cost = calculateLlmCost(
      { provider: "p", model: "m", inputPricePer1kTokens: 0.001, outputPricePer1kTokens: 0.003, currency: "USD" },
      1000,
      500,
    );
    expect(cost).toBe(0.0025);
  });

  test("estimates cost from total tokens when input/output are unavailable", () => {
    const cost = estimateLlmCostFromTotal(
      { provider: "p", model: "m", inputPricePer1kTokens: 0.001, outputPricePer1kTokens: 0.003, currency: "USD" },
      1500,
    );
    expect(cost).toBe(0.003);
  });
});
