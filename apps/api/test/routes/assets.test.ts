import { test, expect, describe, vi, beforeEach } from "vitest";
import { build, authHeaders, getTestWorkspaceUuid } from "../helper";

const mockStorage = {
  getUploadUrl: vi.fn().mockResolvedValue({
    signedUrl: "https://s3.test/signed",
    publicUrl: "https://cdn.test/test.png",
    storageKey: "workspaces/test/assets/123-test.png",
  }),
  getDownloadUrl: vi.fn().mockResolvedValue("https://s3.test/download-signed"),
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
        mimeType: "image/png",
        url: "https://cdn.test/test.png",
        storageKey: `workspaces/${workspaceUuid}/assets/123-test.png`,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("test.png");
    expect(body.type).toBe("image");
    expect(body.workspaceUuid).toBeDefined();

    await app.close();
  });

  test("POST /assets rejects a storage key outside the workspace", async () => {
    const app = await build();

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

  test("GET /assets/:uuid/raw redirects to a signed download URL", async () => {
    const app = await buildWithMockStorage();
    const workspaceUuid = await getTestWorkspaceUuid();

    const created = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: authHeaders(),
      payload: {
        name: "raw.png",
        type: "image",
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

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://s3.test/download-signed");
    expect(mockStorage.getDownloadUrl).toHaveBeenCalledWith(
      `workspaces/${workspaceUuid}/assets/raw.png`,
    );

    await app.close();
  });
});
