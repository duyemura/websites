import { describe, test, expect } from "vitest";
import { deriveMessages } from "../src/lib/build-messages";
import type { BuildStatus, BuildCommandResponse } from "../src/lib/api";

function buildSite(overrides?: Partial<BuildStatus["site"]>): BuildStatus["site"] {
  return {
    uuid: "site-1",
    workspaceUuid: "ws-1",
    slug: "home",
    name: "Test Gym",
    status: "draft",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function buildStatus(overrides?: Partial<BuildStatus>): BuildStatus {
  return {
    site: buildSite(),
    aiJob: null,
    deployment: null,
    blueprint: null,
    aiActivity: [],
    ...overrides,
  };
}

describe("deriveMessages", () => {
  test("includes a welcome message", () => {
    const messages = deriveMessages(buildStatus(), []);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.content).toContain("Test Gym");
  });

  test("includes job status as a system message", () => {
    const status = buildStatus({
      aiJob: {
        uuid: "job-1",
        type: "replicate_site",
        status: "running",
        state: { phase: "build", currentSlug: "index" },
        steps: [],
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:01:00.000Z",
      },
    });
    const messages = deriveMessages(status, []);
    const systemMessages = messages.filter((m) => m.role === "system");
    expect(systemMessages.length).toBeGreaterThan(0);
    expect(systemMessages[0]?.content).toContain("Building: build");
  });

  test("includes ai activity summaries", () => {
    const status = buildStatus({
      aiActivity: [
        {
          uuid: "act-1",
          actionType: "scrape",
          outcome: "success",
          summary: "Scraped homepage",
          createdAt: "2026-06-30T00:02:00.000Z",
          metadata: null,
        },
      ],
    });
    const messages = deriveMessages(status, []);
    expect(messages.some((m) => m.content === "Scraped homepage")).toBe(true);
  });

  test("includes command responses", () => {
    const response: BuildCommandResponse = {
      reply: "Published successfully",
      action: "publish_page",
      enqueued: true,
    };
    const messages = deriveMessages(buildStatus(), [response]);
    expect(messages.some((m) => m.content === "Published successfully")).toBe(true);
  });

  test("sorts messages chronologically", () => {
    const status = buildStatus({
      aiActivity: [
        {
          uuid: "act-1",
          actionType: "scrape",
          outcome: "success",
          summary: "Later activity",
          createdAt: "2026-06-30T00:02:00.000Z",
          metadata: null,
        },
        {
          uuid: "act-2",
          actionType: "scrape",
          outcome: "success",
          summary: "Earlier activity",
          createdAt: "2026-06-30T00:01:00.000Z",
          metadata: null,
        },
      ],
    });
    const messages = deriveMessages(status, []);
    const activityMessages = messages.filter((m) =>
      ["Earlier activity", "Later activity"].includes(m.content),
    );
    expect(activityMessages[0]?.content).toBe("Earlier activity");
    expect(activityMessages[1]?.content).toBe("Later activity");
  });
});
