import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "../../database";
import { logAiActivity, getRecentAiActivity, getAiActivityCostSummary } from "../ai-activity";

const TEST_USER = "user_test";

describe("ai-activity service", () => {
  let workspaceUuid: string;

  beforeEach(async () => {
    const workspace = await db
      .insertInto("workspaces")
      .values({ name: "AI Activity Test Workspace", slug: `ai-activity-test-${Date.now()}` })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    workspaceUuid = workspace.uuid;
  });

  afterEach(async () => {
    await db.deleteFrom("aiActivity").where("workspaceUuid", "=", workspaceUuid).execute();
    await db.deleteFrom("workspaces").where("uuid", "=", workspaceUuid).execute();
  });

  test("logs an AI activity row", async () => {
    const uuid = await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "generate",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.012,
      latencyMs: 2345,
      outcome: "success",
      summary: "Generated homepage hero section",
      promptTemplateKeys: ["master-context", "hero-section"],
      inputDocKeys: ["workspace-memory", "brand-guidelines"],
    });

    expect(uuid).toBeDefined();

    const recent = await getRecentAiActivity(db, { workspaceUuid });
    expect(recent.length).toBe(1);
    expect(recent[0]?.summary).toBe("Generated homepage hero section");
    expect(recent[0]?.model).toBe("claude-sonnet-4-6");
    expect(recent[0]?.inputTokens).toBe(1000);
    expect(recent[0]?.outcome).toBe("success");
    expect(recent[0]?.promptTemplateKeys).toBe("master-context,hero-section");
  });

  test("filters by action type and outcome", async () => {
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "generate",
      outcome: "success",
      summary: "Generate success",
    });
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "generate",
      outcome: "failure",
      summary: "Generate failure",
      errorMessage: "Model timeout",
    });
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "memory_update",
      outcome: "success",
      summary: "Memory update",
    });

    const failures = await getRecentAiActivity(db, {
      workspaceUuid,
      actionType: "generate",
      outcome: "failure",
    });
    expect(failures.length).toBe(1);
    expect(failures[0]?.summary).toBe("Generate failure");
  });

  test("summarizes cost and token usage", async () => {
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "generate",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.012,
      outcome: "success",
      summary: "First generation",
    });
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "replicate",
      inputTokens: 2000,
      outputTokens: 1500,
      costUsd: 0.025,
      outcome: "partial",
      summary: "Replication pass",
    });

    const summary = await getAiActivityCostSummary(db, workspaceUuid);
    expect(summary.totalCostUsd).toBeCloseTo(0.037, 3);
    expect(summary.totalTokens).toBe(5000);
    expect(summary.count).toBe(2);
  });
});
