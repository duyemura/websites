import { test, expect, describe, vi, beforeEach } from "vitest";
import { build, authHeaders, getTestWorkspaceUuid } from "../helper";

const mockStorage = {
  getUploadUrl: vi.fn().mockResolvedValue({
    signedUrl: "https://s3.test/signed",
    publicUrl: "https://cdn.test/test.png",
    storageKey: "workspaces/test/assets/123-test.png",
  }),
  getDownloadUrl: vi.fn().mockResolvedValue("https://s3.test/download-signed"),
  getObjectStream: vi.fn().mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("test-image-data"));
        controller.close();
      },
    }),
  ),
  deleteObject: vi.fn().mockResolvedValue(undefined),
};

async function buildWithMockStorage() {
  const app = await build();
  app.storage = mockStorage;
  return app;
}

describe("asset routes", () => {
  beforeEach(() => {
    mockStorage.getUploadUrl.mockClear();
    mockStorage.getDownloadUrl.mockClear();
    mockStorage.getObjectStream.mockClear();
    mockStorage.deleteObject.mockClear();
  });

  test("GET /assets/upload-url returns a signed URL", async () => {
    const app = await buildWithMockStorage();

    const response = await app.inject({
      method: "GET",
      url: "/api/assets/upload-url?filename=test.png",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.signedUrl).toBe("https://s3.test/signed");
    expect(body.publicUrl).toBe("https://cdn.test/test.png");
    expect(body.storageKey).toBe("workspaces/test/assets/123-test.png");
    expect(mockStorage.getUploadUrl).toHaveBeenCalledWith(
      expect.any(String),
      "test.png",
      undefined,
    );

    await app.close();
  });

  test("GET /assets/upload-url passes content type", async () => {
    const app = await buildWithMockStorage();

    const response = await app.inject({
      method: "GET",
      url: "/api/assets/upload-url?filename=test.png&contentType=image/png",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(mockStorage.getUploadUrl).toHaveBeenCalledWith(
      expect.any(String),
      "test.png",
      "image/png",
    );

    await app.close();
  });

  test("POST /assets creates an asset record", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    const response = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "test.png",
        type: "image",
        source: "upload",
        mimeType: "image/png",
        url: "https://cdn.test/test.png",
        storageKey: `workspaces/${workspaceUuid}/assets/123-test.png`,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("test.png");
    expect(body.type).toBe("image");
    expect(body.source).toBe("upload");
    expect(body.workspaceUuid).toBeDefined();

    await app.close();
  });

  test("POST /assets rejects a storage key outside the workspace", async () => {
    const app = await build();
    await getTestWorkspaceUuid();

    const response = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "test.png",
        type: "image",
        mimeType: "image/png",
        url: "https://cdn.test/test.png",
        storageKey: "workspaces/other-workspace/assets/123-test.png",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid storage key" });

    await app.close();
  });

  test("GET /assets lists workspace assets", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "a.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/a.png",
        storageKey: `workspaces/${workspaceUuid}/assets/a`,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);

    await app.close();
  });

  test("GET /assets excludes screenshot source assets", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "visible.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/visible.png",
        storageKey: `workspaces/${workspaceUuid}/assets/visible`,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "hidden.png",
        type: "image",
        source: "screenshot",
        url: "https://cdn.test/hidden.png",
        storageKey: `workspaces/${workspaceUuid}/assets/hidden`,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("visible.png");

    await app.close();
  });

  test("PUT /assets/:uuid updates an asset", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    const created = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "old.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/old.png",
        storageKey: `workspaces/${workspaceUuid}/assets/old`,
      },
    });
    const uuid = created.json().uuid;

    const response = await app.inject({
      method: "PUT",
      url: `/api/assets/${uuid}`,
      headers: authHeaders(),
      payload: { name: "new.png", type: "logo" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe("new.png");
    expect(body.type).toBe("logo");

    await app.close();
  });

  test("DELETE /assets/:uuid removes the record and storage object", async () => {
    const app = await buildWithMockStorage();
    const workspaceUuid = await getTestWorkspaceUuid();

    const created = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "delete.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/delete.png",
        storageKey: `workspaces/${workspaceUuid}/assets/delete.png`,
      },
    });
    const uuid = created.json().uuid;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/assets/${uuid}`,
      headers: authHeaders(),
    });

    expect(deleted.statusCode).toBe(204);
    expect(mockStorage.deleteObject).toHaveBeenCalledWith(
      `workspaces/${workspaceUuid}/assets/delete.png`,
    );

    const list = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers: authHeaders(),
    });
    expect(list.json()).toHaveLength(0);

    await app.close();
  });

  test("GET /assets/:uuid/raw streams the object", async () => {
    const app = await buildWithMockStorage();
    const workspaceUuid = await getTestWorkspaceUuid();

    const created = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "raw.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/raw.png",
        storageKey: `workspaces/${workspaceUuid}/assets/raw.png`,
      },
    });
    const uuid = created.json().uuid;

    const response = await app.inject({
      method: "GET",
      url: `/api/assets/${uuid}/raw`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("test-image-data");
    expect(mockStorage.getObjectStream).toHaveBeenCalledWith(
      `workspaces/${workspaceUuid}/assets/raw.png`,
    );

    await app.close();
  });

  test("GET /assets filters by source", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "upload.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/upload.png",
        storageKey: `workspaces/${workspaceUuid}/assets/upload`,
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "scraped.png",
        type: "image",
        source: "scraped",
        url: "https://cdn.test/scraped.png",
        storageKey: `workspaces/${workspaceUuid}/assets/scraped`,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/assets?source=scraped",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].source).toBe("scraped");

    await app.close();
  });

  test("GET /assets filters by analyzed status", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "analyzed.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/analyzed.png",
        storageKey: `workspaces/${workspaceUuid}/assets/analyzed`,
        metadata: {
          analysis: {
            analyzedAt: new Date().toISOString(),
            model: "test",
            version: 1,
            description: "d",
            altText: "a",
            context: "other",
            confidence: 0.5,
            tags: [],
            technical: { hasText: false, textConfidence: 0 },
            quality: { score: 3, resolution: "medium", sharpness: "good", issues: [] },
            marketing: { mood: "calm", useCases: [], subject: "s" },
            safety: { hasIdentifiablePeople: false, needsReview: false },
          },
        },
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "unanalyzed.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/unanalyzed.png",
        storageKey: `workspaces/${workspaceUuid}/assets/unanalyzed`,
      },
    });

    const analyzedResponse = await app.inject({
      method: "GET",
      url: "/api/assets?analyzed=true",
      headers: authHeaders(),
    });
    expect(analyzedResponse.json()).toHaveLength(1);
    expect(analyzedResponse.json()[0].name).toBe("analyzed.png");

    const unanalyzedResponse = await app.inject({
      method: "GET",
      url: "/api/assets?analyzed=false",
      headers: authHeaders(),
    });
    expect(unanalyzedResponse.json()).toHaveLength(1);
    expect(unanalyzedResponse.json()[0].name).toBe("unanalyzed.png");

    await app.close();
  });

  test("GET /assets filters by tag", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "hero.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/hero.png",
        storageKey: `workspaces/${workspaceUuid}/assets/hero`,
        metadata: {
          analysis: {
            analyzedAt: new Date().toISOString(),
            model: "test",
            version: 1,
            description: "d",
            altText: "a",
            context: "hero",
            confidence: 0.9,
            tags: ["hero-candidate"],
            technical: { hasText: false, textConfidence: 0 },
            quality: { score: 5, resolution: "high", sharpness: "sharp", issues: [] },
            marketing: { mood: "energetic", useCases: ["hero"], subject: "gym" },
            safety: { hasIdentifiablePeople: false, needsReview: false },
          },
        },
      },
    });

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "logo.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/logo.png",
        storageKey: `workspaces/${workspaceUuid}/assets/logo`,
        metadata: {
          analysis: {
            analyzedAt: new Date().toISOString(),
            model: "test",
            version: 1,
            description: "d",
            altText: "a",
            context: "logo",
            confidence: 0.9,
            tags: ["logo"],
            technical: { hasText: false, textConfidence: 0 },
            quality: { score: 5, resolution: "high", sharpness: "sharp", issues: [] },
            marketing: { mood: "professional", useCases: ["logo"], subject: "brand" },
            safety: { hasIdentifiablePeople: false, needsReview: false },
          },
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/assets?tag=hero-candidate",
      headers: authHeaders(),
    });
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].name).toBe("hero.png");

    await app.close();
  });

  test("POST /assets enqueues image classification", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();
    const addSpy = vi.spyOn(app.queues.classifyAssets.queue, "add");

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "enqueue.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/enqueue.png",
        storageKey: `workspaces/${workspaceUuid}/assets/enqueue`,
      },
    });

    expect(addSpy).toHaveBeenCalledWith("classify_assets", expect.any(Object));

    addSpy.mockRestore();
    await app.close();
  });

  test("POST /assets/:uuid/regenerate-analysis enqueues classification", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    const created = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "regenerate.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/regenerate.png",
        storageKey: `workspaces/${workspaceUuid}/assets/regenerate`,
      },
    });
    const uuid = created.json().uuid;

    const addSpy = vi.spyOn(app.queues.classifyAssets.queue, "add");

    const response = await app.inject({
      method: "POST",
      url: `/api/assets/${uuid}/regenerate-analysis`,
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(202);
    expect(addSpy).toHaveBeenCalledWith("classify_assets", expect.any(Object));

    addSpy.mockRestore();
    await app.close();
  });

  test("POST /assets/backfill-analysis enqueues unanalyzed images", async () => {
    const app = await build();
    const workspaceUuid = await getTestWorkspaceUuid();

    await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "backfill.png",
        type: "image",
        source: "upload",
        url: "https://cdn.test/backfill.png",
        storageKey: `workspaces/${workspaceUuid}/assets/backfill`,
      },
    });

    const addSpy = vi.spyOn(app.queues.classifyAssets.queue, "add");

    const response = await app.inject({
      method: "POST",
      url: "/api/assets/backfill-analysis",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().enqueued).toBeGreaterThanOrEqual(1);
    expect(addSpy).toHaveBeenCalled();

    addSpy.mockRestore();
    await app.close();
  });
});
