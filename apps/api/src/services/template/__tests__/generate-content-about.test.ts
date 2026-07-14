// @vitest-environment node
import { describe, test, expect, vi } from "vitest";
import { generateAboutContent } from "../generate-content";
import { beanburitoSpec, NO_IMAGE } from "@milo/shared-types";

vi.mock("../../../ai/llm-client", () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from "../../../ai/llm-client";

const mockedChatCompletion = vi.mocked(chatCompletion);

function makeConfig() {
  return {
    DEFAULT_LLM_MODEL: "test-model",
    LLM_PROVIDER: "openrouter",
    OPENROUTER_BASE_URL: "https://test",
    OPENROUTER_API_KEY: "key",
  } as any;
}

function makeAboutJson(extra?: Record<string, unknown>) {
  return {
    hero: {
      subheading: "OUR STORY",
      headline: "Built Around People, Not Machines",
      intro: "Since 2018 we've helped Torrance neighbors build strength.",
      ctaLabel: "Book a tour",
      ctaUrl: "/contact",
    },
    story: {
      headline: "How Test Gym Started",
      subheadline: "Two coaches, one empty warehouse.",
      imageUrl: "/_assets/founders.webp",
      imageAlt: "Founders",
      blocks: [{ type: "text", html: "<p>We opened Test Gym because...</p>" }],
    },
    community: {
      headline: "A Community That Keeps You Going",
      body: "<p>Training here means you're never alone.</p>",
    },
    team: {
      headline: "Meet Your Coaches",
      members: [{ name: "Alex Reed", title: "Head Coach", photoUrl: "", bio: "10 years coaching." }],
    },
    testimonials: {
      headline: "Loved by Members",
      items: [{ quote: "Best gym in town.", name: "Jamie" }],
    },
    ctaBand: { headline: "Come See What Makes Us Different", ctaLabel: "Book a tour", ctaUrl: "/contact" },
    faq: [{ question: "Q1", answer: "A1" }],
    ...extra,
  };
}

describe("generateAboutContent", () => {
  test("parses LLM JSON into a structured AboutContent partial", async () => {
    mockedChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify(makeAboutJson()),
    });

    const logs: string[] = [];
    const result = await generateAboutContent({
      config: makeConfig(),
      spec: beanburitoSpec,
      businessInfo: "Test Gym in Torrance.",
      brandGuidelines: "",
      siteStrategy: "",
      siteHierarchy: "",
      artifactContext: "",
      brief: undefined,
      sitePlaybook: "",
      conversionBrief: "",
      log: (msg) => logs.push(msg),
    });

    expect(result).not.toBeNull();
    expect(result?.hero?.headline).toBe("Built Around People, Not Machines");
    expect(result?.story?.blocks).toHaveLength(1);
    expect(result?.story?.imageUrl).toBe("/_assets/founders.webp");
    expect(result?.team).toHaveLength(1);
    expect(result?.team?.[0].name).toBe("Alex Reed");
    expect(result?.team?.[0].photoUrl).toBe(NO_IMAGE);
    expect(result?.ctaHeadline).toBe("Come See What Makes Us Different");
    expect(result?.faq).toHaveLength(1);
    expect(logs.some((m) => m.includes("warn"))).toBe(false);
  });

  test("returns null when LLM returns no valid JSON after two attempts", async () => {
    mockedChatCompletion.mockResolvedValue({ content: "not valid json" });

    const logs: string[] = [];
    const result = await generateAboutContent({
      config: makeConfig(),
      spec: beanburitoSpec,
      businessInfo: "",
      brandGuidelines: "",
      siteStrategy: "",
      siteHierarchy: "",
      artifactContext: "",
      brief: undefined,
      sitePlaybook: "",
      conversionBrief: "",
      log: (msg) => logs.push(msg),
    });

    expect(result).toBeNull();
    expect(logs.some((m) => m.includes("about attempt 2") && m.includes("warn"))).toBe(true);
  });

  test("filters out incomplete team members and testimonials", async () => {
    mockedChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify(
        makeAboutJson({
          team: {
            members: [
              { name: "Alex Reed", title: "Head Coach", photoUrl: "", bio: "" },
              { name: "", title: "Coach", photoUrl: "", bio: "" },
              { name: "Sam Jones", title: "", photoUrl: "", bio: "" },
            ],
          },
          testimonials: {
            items: [
              { quote: "Great gym", name: "Jamie" },
              { quote: "", name: "Missing" },
              { quote: "Love it" },
            ],
          },
        }),
      ),
    });

    const result = await generateAboutContent({
      config: makeConfig(),
      spec: beanburitoSpec,
      businessInfo: "",
      brandGuidelines: "",
      siteStrategy: "",
      siteHierarchy: "",
      artifactContext: "",
      brief: undefined,
      sitePlaybook: "",
      conversionBrief: "",
      log: () => {},
    });

    expect(result?.team).toHaveLength(1);
    expect(result?.team?.[0].name).toBe("Alex Reed");
    expect(result?.testimonials).toHaveLength(1);
    expect(result?.testimonials?.[0].name).toBe("Jamie");
  });

  test("includes the beanburito about-page spec in the LLM prompt", async () => {
    mockedChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify(makeAboutJson()),
    });

    await generateAboutContent({
      config: makeConfig(),
      spec: beanburitoSpec,
      businessInfo: "",
      brandGuidelines: "",
      siteStrategy: "",
      siteHierarchy: "",
      artifactContext: "",
      brief: undefined,
      sitePlaybook: "",
      conversionBrief: "",
      log: () => {},
    });

    const call = mockedChatCompletion.mock.calls[0];
    const prompt = call?.[0].messages?.[0]?.content as string;
    expect(prompt).toContain("TEMPLATE PAGE TYPE: ABOUT (beanburito)");
    expect(prompt).toContain("=== SECTION: STORY ===");
    expect(prompt).toContain("=== SECTION: TEAM ===");
  });
});
