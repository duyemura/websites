import { describe, test, expect, vi } from "vitest";
import { renderVisualBlock } from "../visual-section-renderer";
import * as llmClient from "../../ai/llm-client";
import type { HierarchySection } from "../../types/site-hierarchy";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type { Config } from "../../plugins/env";

function makeHierarchySection(overrides?: Partial<HierarchySection>): HierarchySection {
  return {
    id: "section-1",
    tag: "content-block",
    intent: "Describe the gym's community and offerings",
    content: {
      heading: "About us",
      body: "We are a community-driven gym focused on functional fitness.",
      eyebrow: "Who we are",
      items: [
        { title: "CrossFit", description: "High intensity functional fitness." },
        { title: "Yoga", description: "Stretch and recover." },
      ],
      images: [{ url: "https://example.com/about.jpg", alt: "Gym community" }],
      cta: { label: "Join today", href: "#join" },
    },
    evidenceId: "ev-1",
    ...overrides,
  };
}

function makeDesignSystem(): DesignSystemV2 {
  return {
    version: "2",
    siteMetadata: {
      framework: "astro",
      mode: "replication",
      targetUrl: "https://example.com",
      generatedAt: new Date().toISOString(),
    },
    global: {
      tokens: {
        colors: {
          primary: "#171717",
          primaryForeground: "#ffffff",
          background: "#ffffff",
          foreground: "#171717",
          muted: "#f5f5f5",
          mutedForeground: "#737373",
          border: "#e5e5e5",
        },
        fonts: {
          heading: "Sans-serif",
          body: "Sans-serif",
        },
        radius: "0.5rem",
      },
      shell: {
        navLinks: [{ label: "Home", href: "/" }],
      },
      rules: {},
    },
    business: {
      name: "Acme Gym",
      tagline: "Train with purpose",
    },
    brand: {
      logo: { type: "text", value: "Acme Gym" },
      headingStyle: { uppercase: false, bold: true },
    },
    reference: {},
  };
}

function makeConfig(): Config {
  return {
    NODE_ENV: "test",
    SERVICE: "api",
    APP_ID: "app_test",
    APP_BASE_URL: "https://test.pushpresslocal.com",
    LLM_PROVIDER: "openrouter",
    DEFAULT_LLM_MODEL: "openai/gpt-4o-mini",
    VISION_LLM_MODEL: "openai/gpt-4o",
    CHEAP_LLM_MODEL: "openai/gpt-4o-mini",
    CODE_LLM_MODEL: "anthropic/claude-3-7-sonnet-latest",
    LONG_CONTEXT_LLM_MODEL: "openai/gpt-4o",
    REASONING_LLM_MODEL: "anthropic/claude-3-7-sonnet-latest",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api",
    OPENROUTER_API_KEY: "test-key",
    OLLAMA_BASE_URL: "http://localhost:11434",
    DB_HOST: "localhost",
    DB_PORT: 5432,
    DB_USER: "postgres",
    DB_PASSWORD: "postgres",
    DB_NAME: "test",
    REDIS_URL: "redis://localhost:6379",
    S3_ENDPOINT: "",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "",
    S3_SECRET_KEY: "",
    S3_ASSETS_BUCKET: "test-bucket",
  } as unknown as Config;
}

describe("visual-section-renderer", () => {
  test("returns deterministic fallback block when no screenshot is provided", async () => {
    const section = makeHierarchySection();
    const designSystem = makeDesignSystem();

    const source = await renderVisualBlock({
      section,
      designSystem,
      config: makeConfig(),
    });

    expect(source).toContain("About us");
    expect(source).toContain("We are a community-driven gym focused on functional fitness.");
    expect(source).toContain("Who we are");
    expect(source).toContain("CrossFit");
    expect(source).toContain("Yoga");
    expect(source).toContain("Join today");
    expect(source).toContain("https://example.com/about.jpg");
    expect(source).toContain("bg-[var(--color-background)]");
    expect(source).not.toContain("```");
  });

  test("uses tag as heading fallback when content heading is missing", async () => {
    const section = makeHierarchySection({ content: { heading: undefined, body: "Body text" } });
    const designSystem = makeDesignSystem();

    const source = await renderVisualBlock({
      section,
      designSystem,
      config: makeConfig(),
    });

    expect(source).toContain("content-block");
  });

  test("returns LLM-generated source and strips markdown fences when screenshot evidence is provided", async () => {
    vi.spyOn(llmClient, "chatCompletion").mockResolvedValueOnce({
      content: "```astro\n<section class=\"hero\">\n  <h1>About us</h1>\n</section>\n```",
    });

    const section = makeHierarchySection();
    const designSystem = makeDesignSystem();
    const evidence = {
      evidenceId: "ev-1",
      pageSlug: "index",
      sectionId: "section-1",
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: [],
      screenshotUrl: "https://example.com/section.png",
    };

    const source = await renderVisualBlock({
      section,
      evidence,
      designSystem,
      config: makeConfig(),
    });

    expect(source).toContain("<section class=\"hero\">");
    expect(source).toContain("<h1>About us</h1>");
    expect(source).not.toContain("```");
  });

  test("includes mobile screenshot and interaction captures when provided", async () => {
    const captured: { messages: unknown; prompt: string } = { messages: null, prompt: "" };
    vi.spyOn(llmClient, "chatCompletion").mockImplementationOnce(async (opts) => {
      captured.messages = opts.messages;
      const first = opts.messages[0];
      if (first && Array.isArray(first.content)) {
        const textPart = first.content.find((c) => c.type === "text");
        if (textPart && "text" in textPart) captured.prompt = textPart.text;
      }
      return { content: "<section>ok</section>" };
    });

    const section = makeHierarchySection();
    const designSystem = makeDesignSystem();
    const evidence = {
      evidenceId: "ev-1",
      pageSlug: "index",
      sectionId: "section-1",
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: [],
      screenshotUrl: "https://example.com/desktop.png",
      mobileScreenshotUrl: "https://example.com/mobile.png",
      interactionCaptures: [
        {
          trigger: "click" as const,
          beforeUrl: "https://x/b.png",
          afterUrl: "https://x/a.png",
          styleDiff: [{ selector: ".menu", property: "display", before: "none", after: "flex" }],
          componentPattern: "dropdown" as const,
        },
      ],
    };

    await renderVisualBlock({
      section,
      evidence,
      designSystem,
      config: makeConfig(),
    });

    expect(captured.prompt).toContain("Interactive components");
    expect(captured.prompt).toContain("dropdown");
    const msgs = captured.messages as { content: unknown[] }[];
    const parts = msgs[0]?.content as { type: string }[];
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(2);
  });

  test("falls back to deterministic block when the LLM call fails", async () => {
    vi.spyOn(llmClient, "chatCompletion").mockRejectedValueOnce(new Error("LLM unavailable"));

    const section = makeHierarchySection();
    const designSystem = makeDesignSystem();
    const evidence = {
      evidenceId: "ev-1",
      pageSlug: "index",
      sectionId: "section-1",
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      computedStyles: [],
      screenshotUrl: "https://example.com/section.png",
    };

    const source = await renderVisualBlock({
      section,
      evidence,
      designSystem,
      config: makeConfig(),
    });

    expect(source).toContain("About us");
    expect(source).toContain("Join today");
    expect(source).not.toContain("```");
  });
});
