import { describe, test, expect, vi, afterEach } from "vitest";
import type { Kysely } from "kysely";
import type { DB } from "../../../types/db";
import type { ScrapedWebsiteData } from "../../../utils/scrape-docs";
import * as llmClient from "../../llm-client";
import * as llmPricing from "../../../services/llm-pricing";
import * as aiActivity from "../../../services/ai-activity";
import {
  buildCorpusInput,
  extractWorkspaceMemoryFields,
  loadIcpStandard,
  loadWorkspaceMemoryExtractionTemplate,
} from "../workspace-memory-extraction";

const fakeDb = {} as Kysely<DB>;

const fakeConfig = {
  LLM_PROVIDER: "ollama",
  DEFAULT_LLM_MODEL: "qwen3.5:397b-cloud",
} as unknown as import("../../../plugins/env").Config;

afterEach(() => {
  vi.restoreAllMocks();
});

const baseScrape: ScrapedWebsiteData = {
  url: "https://example-gym.com",
  title: "Beta Gym",
  description: "A community gym for functional fitness.",
  businessName: "Beta Gym",
  tagline: "Stronger together.",
  headings: ["Train with purpose", "Join today"],
  paragraphs: ["We build fitness for real life."],
  buttons: ["Book a class"],
  navLinks: [],
  colors: [],
  fonts: [],
  fontSizes: [],
  images: [],
  layoutRules: [],
  faqs: [],
  testimonials: [{ quote: "Best gym in town.", author: "Jane D." }],
  locations: [],
  team: [{ name: "Coach Alex", role: "Head coach", bio: "CSCS certified." }],
  offerings: [{ name: "Group class", description: "One hour", price: "$30" }],
  contact: {},
};

describe("workspace-memory-extraction prompts", () => {
  test("loads extraction template", () => {
    const template = loadWorkspaceMemoryExtractionTemplate();
    expect(template).toContain("Workspace Memory Extraction");
    expect(template).toContain("industry");
    expect(template).toContain("targetMembers");
    expect(template).toContain("antiTargetMembers");
    expect(template).toContain("differentiators");
    expect(template).toContain("businessPriorities");
    expect(template).toContain("website copy, blog content, ads, and other marketing materials");
  });

  test("loads ICP standard", () => {
    const standard = loadIcpStandard();
    expect(standard).toContain("ICP Standard");
    expect(standard).toContain("jobsToBeDone");
    expect(standard).toContain("entrySignals");
    expect(standard).toContain("Anti-ICP");
  });

  test("corpus input includes all source fields", () => {
    const input = buildCorpusInput(baseScrape, undefined, "fitness / gym");
    expect(input).toContain("Beta Gym");
    expect(input).toContain("Stronger together");
    expect(input).toContain("Train with purpose");
    expect(input).toContain("Group class");
    expect(input).toContain("Best gym in town");
    expect(input).toContain("Coach Alex");
  });

  test("extractWorkspaceMemoryFields returns result even when logging fails", async () => {
    vi.spyOn(llmClient, "chatCompletion").mockResolvedValueOnce({
      content: JSON.stringify({ industry: "fitness / gym" }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      latencyMs: 123,
      raw: {},
    });
    vi.spyOn(llmPricing, "getLlmPricing").mockResolvedValueOnce({
      provider: "ollama",
      model: "qwen3.5:397b-cloud",
      inputPricePer1kTokens: 0.001,
      outputPricePer1kTokens: 0.003,
      currency: "USD",
    });
    vi.spyOn(llmPricing, "calculateLlmCost").mockReturnValueOnce(0.00035);
    vi.spyOn(aiActivity, "logAiActivity").mockRejectedValueOnce(new Error("logging failed"));

    const result = await extractWorkspaceMemoryFields(
      baseScrape,
      undefined,
      "fitness / gym",
      fakeConfig,
      {
        db: fakeDb,
        workspaceUuid: "ws-test",
        userUuid: "user-test",
        siteUuid: "site-test",
      },
    );

    expect(llmClient.chatCompletion).toHaveBeenCalled();
    expect(aiActivity.logAiActivity).toHaveBeenCalled();
    expect(result).toEqual({ industry: "fitness / gym" });
  });

  test("falls back to total-only cost estimate and sanitizes raw response", async () => {
    const rawResponse = {
      id: "resp_123",
      model: "qwen3.5:397b-cloud",
      created: 1234567890,
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
      usage: { total_tokens: 150, prompt_tokens: 100, completion_tokens: 50 },
      system_fingerprint: "should-be-excluded",
    };
    vi.spyOn(llmClient, "chatCompletion").mockResolvedValueOnce({
      content: JSON.stringify({ industry: "fitness / gym" }),
      usage: { totalTokens: 150 },
      latencyMs: 123,
      raw: rawResponse,
    });
    const pricing = {
      provider: "ollama",
      model: "qwen3.5:397b-cloud",
      inputPricePer1kTokens: 0.001,
      outputPricePer1kTokens: 0.003,
      currency: "USD",
    };
    vi.spyOn(llmPricing, "getLlmPricing").mockResolvedValueOnce(pricing);
    const estimateSpy = vi.spyOn(llmPricing, "estimateLlmCostFromTotal").mockReturnValueOnce(0.0003);
    const sanitizeSpy = vi.spyOn(llmClient, "sanitizeRawResponse").mockReturnValueOnce({
      providerResponseId: "resp_123",
      responseModel: "qwen3.5:397b-cloud",
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      createdAt: 1234567890,
    });
    vi.spyOn(aiActivity, "logAiActivity").mockResolvedValueOnce("uuid");

    await extractWorkspaceMemoryFields(
      baseScrape,
      undefined,
      "fitness / gym",
      fakeConfig,
      {
        db: fakeDb,
        workspaceUuid: "ws-test",
        userUuid: "user-test",
        siteUuid: "site-test",
      },
    );

    expect(estimateSpy).toHaveBeenCalledWith(pricing, 150);
    expect(sanitizeSpy).toHaveBeenCalledWith(rawResponse);
    expect(aiActivity.logAiActivity).toHaveBeenCalled();
  });
});
