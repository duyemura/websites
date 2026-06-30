import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { build, authHeaders } from "../helper";
import { db } from "../../src/database";
import { logAiActivity } from "../../src/services/ai-activity";

describe("ai-activity routes", () => {
  const TEST_USER = "test-user";
  let workspaceUuid: string;

  beforeEach(async () => {
    const workspace = await db
      .selectFrom("workspaces")
      .select("uuid")
      .where("slug", "=", "test-workspace")
      .executeTakeFirstOrThrow();
    workspaceUuid = workspace.uuid;
  });

  afterEach(async () => {
    await db.deleteFrom("aiActivity").where("workspaceUuid", "=", workspaceUuid).execute();
  });

  test("GET /ai-activity returns empty list and zero summary", async () => {
    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: `/api/ai-activity`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.activities).toEqual([]);
    expect(body.summary).toEqual({ totalCostUsd: 0, totalTokens: 0, count: 0 });

    await app.close();
  });

  test("GET /ai-activity lists workspace activities with summary", async () => {
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "memory_update",
      model: "qwen3.5:397b-cloud",
      provider: "ollama",
      inputTokens: 1200,
      outputTokens: 400,
      costUsd: 0.005,
      latencyMs: 1200,
      outcome: "success",
      summary: "Extracted workspace memory",
    });

    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: `/api/ai-activity`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.activities).toHaveLength(1);
    expect(body.activities[0].summary).toBe("Extracted workspace memory");
    expect(body.activities[0].costUsd).toBe(0.005);
    expect(body.summary.totalCostUsd).toBe(0.005);
    expect(body.summary.totalTokens).toBe(1600);

    await app.close();
  });

  test("GET /ai-activity filters by action type", async () => {
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "generate",
      outcome: "success",
      summary: "Generate page",
    });
    await logAiActivity(db, {
      workspaceUuid,
      userUuid: TEST_USER,
      actionType: "memory_update",
      outcome: "success",
      summary: "Memory update",
    });

    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: `/api/ai-activity?actionType=memory_update`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.activities).toHaveLength(1);
    expect(body.activities[0].actionType).toBe("memory_update");

    await app.close();
  });

  test("GET /ai-activity limits results", async () => {
    for (let i = 0; i < 3; i++) {
      await logAiActivity(db, {
        workspaceUuid,
        userUuid: TEST_USER,
        actionType: "generate",
        outcome: "success",
        summary: `Generation ${i}`,
      });
    }

    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: `/api/ai-activity?limit=2`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.activities).toHaveLength(2);

    await app.close();
  });
});
