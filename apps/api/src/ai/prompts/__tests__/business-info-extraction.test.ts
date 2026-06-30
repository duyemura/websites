import { describe, test, expect, vi, afterEach } from "vitest";
import type { Kysely } from "kysely";
import type { DB } from "../../../types/db";
import type { ScrapedWebsiteData } from "../../../utils/scrape-docs";
import * as llmClient from "../../llm-client";
import * as llmPricing from "../../../services/llm-pricing";
import * as aiActivity from "../../../services/ai-activity";
import {
  extractBusinessInfoFields,
  loadBusinessInfoExtractionTemplate,
} from "../business-info-extraction";

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

function stubLlmResponse(content: string) {
  vi.spyOn(llmClient, "chatCompletion").mockResolvedValueOnce({
    content,
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
  return vi.spyOn(aiActivity, "logAiActivity").mockResolvedValueOnce("uuid");
}

function validBusinessInfo() {
  return {
    businessName: "Beta Gym",
    tagline: "Stronger together.",
    oneLineSummary: "A community gym for functional fitness in Example City.",
    classification: {
      industryNiche: "fitness / gym: functional fitness",
      serviceModel: "group classes + personal training",
      primaryAudience: "busy professionals looking for community fitness",
    },
    contact: {
      phone: "555-1234",
      email: "hi@example-gym.com",
      website: "https://example-gym.com",
      googleMapsUrl: null,
      socials: [],
    },
    offerings: [],
    testimonials: [],
    faqs: [],
    conversionSignals: {
      primaryCta: "Book a class",
      offer: null,
      signupMethod: "Contact form",
    },
    messagingThemes: [],
    competitiveAngle: "Community-focused coaching with small group classes.",
  };
}

describe("business-info-extraction prompts", () => {
  test("loads extraction template", () => {
    const template = loadBusinessInfoExtractionTemplate();
    expect(template).toContain("Business Info Extraction");
    expect(template).toContain("businessName");
    expect(template).toContain("competitiveAngle");
  });

  test("extractBusinessInfoFields returns parsed result for valid JSON", async () => {
    stubLlmResponse(JSON.stringify(validBusinessInfo()));

    const result = await extractBusinessInfoFields(baseScrape, undefined, fakeConfig, {
      db: fakeDb,
      workspaceUuid: "ws-test",
      userUuid: "user-test",
      siteUuid: "site-test",
    });

    expect(result).toEqual(validBusinessInfo());
  });

  test("extractBusinessInfoFields strips markdown fences before parsing", async () => {
    stubLlmResponse("```json\n" + JSON.stringify(validBusinessInfo()) + "\n```");

    const result = await extractBusinessInfoFields(baseScrape, undefined, fakeConfig, {
      db: fakeDb,
      workspaceUuid: "ws-test",
      userUuid: "user-test",
      siteUuid: "site-test",
    });

    expect(result).toEqual(validBusinessInfo());
  });

  test("extractBusinessInfoFields logs detailed error when LLM returns invalid JSON", async () => {
    const logSpy = stubLlmResponse("this is not json");

    const result = await extractBusinessInfoFields(baseScrape, undefined, fakeConfig, {
      db: fakeDb,
      workspaceUuid: "ws-test",
      userUuid: "user-test",
      siteUuid: "site-test",
    });

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalled();
    const call = logSpy.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("logAiActivity was not called");
    const [, activity] = call;
    expect(activity).toBeDefined();
    if (!activity) throw new Error("logAiActivity was not called with activity payload");
    expect(activity.outcome).toBe("partial");
    expect(activity.errorMessage).toContain("Business info extraction response could not be used.");
    expect(activity.errorMessage).toContain("Phase: JSON parse");
    expect(activity.errorMessage).toContain("this is not json");
    expect(activity.errorMessage).toContain("Raw response content:");
  });

  test("extractBusinessInfoFields logs detailed error when JSON fails schema validation", async () => {
    const logSpy = stubLlmResponse(JSON.stringify({ businessName: "Beta Gym" }));

    const result = await extractBusinessInfoFields(baseScrape, undefined, fakeConfig, {
      db: fakeDb,
      workspaceUuid: "ws-test",
      userUuid: "user-test",
      siteUuid: "site-test",
    });

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalled();
    const call = logSpy.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("logAiActivity was not called");
    const [, activity] = call;
    expect(activity).toBeDefined();
    if (!activity) throw new Error("logAiActivity was not called with activity payload");
    expect(activity.outcome).toBe("partial");
    expect(activity.errorMessage).toContain("Business info extraction response could not be used.");
    expect(activity.errorMessage).toContain("Phase: schema validation");
    expect(activity.errorMessage).toContain("Required");
    expect(activity.errorMessage).toContain("Raw response content:");
  });

  test("extractBusinessInfoFields returns parsed result even when logging fails", async () => {
    vi.spyOn(llmClient, "chatCompletion").mockResolvedValueOnce({
      content: JSON.stringify(validBusinessInfo()),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      latencyMs: 123,
      raw: {},
    });
    vi.spyOn(llmPricing, "getLlmPricing").mockRejectedValueOnce(new Error("pricing unavailable"));
    vi.spyOn(aiActivity, "logAiActivity").mockRejectedValueOnce(new Error("logging failed"));

    const result = await extractBusinessInfoFields(baseScrape, undefined, fakeConfig, {
      db: fakeDb,
      workspaceUuid: "ws-test",
      userUuid: "user-test",
      siteUuid: "site-test",
    });

    expect(result).toEqual(validBusinessInfo());
  });

  test("extractBusinessInfoFields preserves HTTP failure outcome and error", async () => {
    vi.spyOn(llmPricing, "getLlmPricing").mockResolvedValueOnce({
      provider: "ollama",
      model: "qwen3.5:397b-cloud",
      inputPricePer1kTokens: 0.001,
      outputPricePer1kTokens: 0.003,
      currency: "USD",
    });
    const logSpy = vi.spyOn(aiActivity, "logAiActivity").mockResolvedValueOnce("uuid");
    const error = new Error("OLLAMA connection refused");
    vi.spyOn(llmClient, "chatCompletion").mockRejectedValueOnce(error);

    const result = await extractBusinessInfoFields(baseScrape, undefined, fakeConfig, {
      db: fakeDb,
      workspaceUuid: "ws-test",
      userUuid: "user-test",
      siteUuid: "site-test",
    });

    expect(result).toBeNull();
    expect(logSpy).toHaveBeenCalled();
    const call = logSpy.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("logAiActivity was not called");
    const [, activity] = call;
    expect(activity).toBeDefined();
    if (!activity) throw new Error("logAiActivity was not called with activity payload");
    expect(activity.outcome).toBe("failure");
    expect(activity.errorMessage).toContain("OLLAMA connection refused");
    expect(activity.errorMessage).not.toContain("Failed to parse JSON");
  });
});
