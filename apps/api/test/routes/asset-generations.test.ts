import { describe, test, expect, vi, beforeEach } from "vitest";
import { build, authHeaders, getTestWorkspaceUuid } from "../helper";
import { db } from "../../src/database";
import type { AssetGenerationStatus } from "../../src/types/db";

describe("asset generation routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function makeGeneration(overrides?: {
    status?: AssetGenerationStatus;
    siteUuid?: string | null;
    subject?: string;
  }) {
    return {
      workspaceUuid: await getTestWorkspaceUuid(),
      userUuid: "test-user",
      useCase: "hero" as const,
      subject: overrides?.subject ?? "Hero generation",
      referenceAssetUuids: null as string[] | null,
      outputSpec: { aspectRatio: "16:9", style: "cinematic" },
      siteUuid: overrides?.siteUuid ?? null,
      status: overrides?.status ?? "pending",
      generatedAssetUuid: null,
      failureReason: null,
      costUsd: null,
      retries: 0,
    };
  }

  test("POST /asset-generations enqueues a generation job", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();
    const addSpy = vi
      .spyOn(app.queues.generateAssets.queue, "add")
      .mockResolvedValue({ id: "job-1" } as Awaited<
        ReturnType<typeof app.queues.generateAssets.queue.add>
      >);

    const response = await app.inject({
      method: "POST",
      url: "/api/asset-generations",
      headers: authHeaders(),
      payload: {
        workspaceUuid,
        useCase: "hero",
        subject: "Empty gym floor at sunrise",
        referenceAssetUuids: [],
        outputSpec: { aspectRatio: "16:9", style: "cinematic" },
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.uuid).toBeDefined();
    expect(body.status).toBe("pending");

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(
      "generate_assets",
      expect.objectContaining({
        workspaceUuid,
        assetGenerationUuid: body.uuid,
        userUuid: expect.any(String),
      }),
      { jobId: body.uuid },
    );

    const row = await db
      .selectFrom("assetGenerations")
      .selectAll()
      .where("uuid", "=", body.uuid)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("pending");
    expect(row.useCase).toBe("hero");
    expect(row.subject).toBe("Empty gym floor at sunrise");

    await app.close();
  });

  test("POST /asset-generations rejects mismatched workspace", async () => {
    const app = await build();
    await getTestWorkspaceUuid();
    const addSpy = vi
      .spyOn(app.queues.generateAssets.queue, "add")
      .mockResolvedValue({ id: "job-1" } as Awaited<
        ReturnType<typeof app.queues.generateAssets.queue.add>
      >);

    const response = await app.inject({
      method: "POST",
      url: "/api/asset-generations",
      headers: authHeaders(),
      payload: {
        workspaceUuid: "00000000-0000-0000-0000-000000000000",
        useCase: "hero",
        subject: "Empty gym floor at sunrise",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "workspaceUuid does not match authenticated workspace",
    });
    expect(addSpy).not.toHaveBeenCalled();

    await app.close();
  });

  test("GET /asset-generations lists workspace generations", async () => {
    await getTestWorkspaceUuid();
    await db
      .insertInto("assetGenerations")
      .values([
        await makeGeneration({ status: "ready", subject: "First" }),
        await makeGeneration({ status: "failed", subject: "Second" }),
      ])
      .execute();

    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: "/api/asset-generations",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(2);
    expect(body[0].subject).toBe("Second");
    expect(body[0].status).toBe("failed");
    expect(body[1].subject).toBe("First");
    expect(body[1].status).toBe("ready");

    await app.close();
  });

  test("GET /asset-generations filters by site", async () => {
    const workspaceUuid = await getTestWorkspaceUuid();
    const site = await db
      .insertInto("sites")
      .values({
        workspaceUuid,
        name: "Test Site",
        slug: `test-site-${Date.now()}`,
      })
      .returning("uuid")
      .executeTakeFirstOrThrow();

    await db
      .insertInto("assetGenerations")
      .values([
        await makeGeneration({ siteUuid: site.uuid }),
        await makeGeneration({ siteUuid: null }),
      ])
      .execute();

    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: `/api/asset-generations?siteUuid=${site.uuid}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].siteUuid).toBe(site.uuid);

    await app.close();
  });

  test("GET /asset-generations/:uuid returns a generation", async () => {
    const workspaceUuid = await getTestWorkspaceUuid();
    const { uuid } = await db
      .insertInto("assetGenerations")
      .values(await makeGeneration({ status: "ready" }))
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: `/api/asset-generations/${uuid}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.uuid).toBe(uuid);
    expect(body.status).toBe("ready");
    expect(body.workspaceUuid).toBe(await workspaceUuid);

    await app.close();
  });

  test("GET /asset-generations/:uuid returns 404 for unknown uuid", async () => {
    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: "/api/asset-generations/00000000-0000-0000-0000-000000000000",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Asset generation not found" });

    await app.close();
  });

  test("POST /asset-generations/:uuid/retry resets and re-enqueues a failed generation", async () => {
    const app = await build();
    await getTestWorkspaceUuid();
    const { uuid } = await db
      .insertInto("assetGenerations")
      .values(
        await makeGeneration({
          status: "failed",
          subject: "Retry me",
          siteUuid: null,
        }),
      )
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const addSpy = vi
      .spyOn(app.queues.generateAssets.queue, "add")
      .mockResolvedValue({ id: "job-2" } as Awaited<
        ReturnType<typeof app.queues.generateAssets.queue.add>
      >);

    const response = await app.inject({
      method: "POST",
      url: `/api/asset-generations/${uuid}/retry`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.uuid).toBe(uuid);
    expect(body.status).toBe("pending");

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(
      "generate_assets",
      expect.objectContaining({ assetGenerationUuid: uuid }),
      { jobId: uuid },
    );

    const row = await db
      .selectFrom("assetGenerations")
      .selectAll()
      .where("uuid", "=", uuid)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("pending");
    expect(row.retries).toBe(0);
    expect(row.failureReason).toBeNull();

    await app.close();
  });

  test("POST /asset-generations/:uuid/retry removes an existing BullMQ job", async () => {
    const app = await build();
    const { uuid } = await db
      .insertInto("assetGenerations")
      .values(await makeGeneration({ status: "failed" }))
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const removeSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(app.queues.generateAssets.queue, "getJob").mockResolvedValue({
      id: uuid,
      remove: removeSpy,
    } as unknown as Awaited<ReturnType<typeof app.queues.generateAssets.queue.getJob>>);
    vi.spyOn(app.queues.generateAssets.queue, "add").mockResolvedValue({
      id: "job-3",
    } as Awaited<ReturnType<typeof app.queues.generateAssets.queue.add>>);

    const response = await app.inject({
      method: "POST",
      url: `/api/asset-generations/${uuid}/retry`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(202);
    expect(removeSpy).toHaveBeenCalledTimes(1);

    await app.close();
  });

  test("POST /asset-generations/:uuid/retry rejects non-failed generations", async () => {
    const app = await build();
    const { uuid } = await db
      .insertInto("assetGenerations")
      .values(await makeGeneration({ status: "pending" }))
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const response = await app.inject({
      method: "POST",
      url: `/api/asset-generations/${uuid}/retry`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Only failed generations can be retried",
    });

    await app.close();
  });

  test("POST /asset-generations/:uuid/retry returns 404 for wrong workspace", async () => {
    const app = await build();
    const otherWorkspace = await db
      .insertInto("workspaces")
      .values({
        slug: `other-${Date.now()}`,
        name: "Other Workspace",
        ownerUserId: "test-user",
        organizationUuid: (await db.selectFrom("workspaces").select("organizationUuid").where("slug", "=", "test-workspace").executeTakeFirstOrThrow()).organizationUuid,
        status: "active",
      })
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const { uuid } = await db
      .insertInto("assetGenerations")
      .values({
        workspaceUuid: otherWorkspace.uuid,
        userUuid: "test-user",
        useCase: "hero",
        subject: "Other workspace generation",
        referenceAssetUuids: null,
        outputSpec: { aspectRatio: "16:9", style: "cinematic" },
        siteUuid: null,
        status: "failed",
        generatedAssetUuid: null,
        failureReason: null,
        costUsd: null,
        retries: 0,
      })
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const response = await app.inject({
      method: "POST",
      url: `/api/asset-generations/${uuid}/retry`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Asset generation not found" });

    await app.close();
  });

  test("DELETE /asset-generations/:uuid deletes a generation", async () => {
    const app = await build();
    const { uuid } = await db
      .insertInto("assetGenerations")
      .values(await makeGeneration({ status: "pending" }))
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/asset-generations/${uuid}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");

    const row = await db
      .selectFrom("assetGenerations")
      .select("uuid")
      .where("uuid", "=", uuid)
      .executeTakeFirst();
    expect(row).toBeUndefined();

    await app.close();
  });

  test("DELETE /asset-generations/:uuid returns 404 for wrong workspace", async () => {
    const app = await build();
    const otherWorkspace = await db
      .insertInto("workspaces")
      .values({
        slug: `other-delete-${Date.now()}`,
        name: "Other Workspace",
        ownerUserId: "test-user",
        organizationUuid: (await db.selectFrom("workspaces").select("organizationUuid").where("slug", "=", "test-workspace").executeTakeFirstOrThrow()).organizationUuid,
        status: "active",
      })
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const { uuid } = await db
      .insertInto("assetGenerations")
      .values({
        workspaceUuid: otherWorkspace.uuid,
        userUuid: "test-user",
        useCase: "hero",
        subject: "Other workspace generation",
        referenceAssetUuids: null,
        outputSpec: { aspectRatio: "16:9", style: "cinematic" },
        siteUuid: null,
        status: "pending",
        generatedAssetUuid: null,
        failureReason: null,
        costUsd: null,
        retries: 0,
      })
      .returning("uuid")
      .executeTakeFirstOrThrow();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/asset-generations/${uuid}`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Asset generation not found" });

    await app.close();
  });

  test("POST /asset-generations rejects creation for non-owner/admin members", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    const memberUser = await db
      .insertInto("users")
      .values({
        email: "member@milo.dev",
        name: "Member User",
        externalUserId: "test-member",
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("workspaceMemberships")
      .values({
        workspaceUuid,
        userUuid: memberUser.uuid,
        role: "member",
      })
      .execute();

    const response = await app.inject({
      method: "POST",
      url: "/api/asset-generations",
      headers: {
        authorization: "Bearer test-member",
        "x-workspace-slug": "test-workspace",
      },
      payload: {
        workspaceUuid,
        useCase: "hero",
        subject: "Member attempt",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "Image generation requires owner or admin access",
    });

    await app.close();
  });
});
