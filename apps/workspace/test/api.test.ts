import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { api, setAuthTokenGetter } from "../src/lib/api";

describe("api client", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setAuthTokenGetter(async () => "test-token");
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("sends workspace and auth headers", async () => {
    await api.getSites();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sites",
      expect.objectContaining({
        headers: {
          "x-workspace-slug": "local",
          Authorization: "Bearer test-token",
        },
      }),
    );
  });

  test("includes Content-Type when there is a body", async () => {
    await api.createSite({ name: "Test", slug: "test" });

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(init?.body).toBe(JSON.stringify({ name: "Test", slug: "test" }));
  });

  test("omits Content-Type for bodyless requests", async () => {
    await api.archiveDoc("my-doc");

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });

  test("throws an error with the response body on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );

    await expect(api.getSites()).rejects.toThrow("404: Not found");
  });

  test("deleteDoc returns the raw response on success", async () => {
    const response = new Response(null, { status: 204 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const result = await api.deleteDoc("my-doc");
    expect(result.status).toBe(204);
  });

  test("updateAsset sends a PUT request with the body", async () => {
    await api.updateAsset("uuid-1", { name: "Renamed", type: "logo" });

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ name: "Renamed", type: "logo" }));
  });

  test("deleteAsset sends a DELETE request without a body", async () => {
    const response = new Response(null, { status: 204 });
    const localSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const result = await api.deleteAsset("uuid-1");
    expect(result.status).toBe(204);

    const [url, init] = localSpy.mock.calls[0];
    expect(url).toBe("/api/assets/uuid-1");
    expect(init?.method).toBe("DELETE");
    expect(init?.headers).not.toHaveProperty("Content-Type");
  });

  test("getAssets builds the query string from filters", async () => {
    await api.getAssets({ source: "upload", analyzed: true, tag: "logo" });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/assets?tag=logo&source=upload&analyzed=true");
  });

  test("getAssets omits the analyzed param when undefined", async () => {
    await api.getAssets({ source: "upload" });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/assets?source=upload");
  });

  test("regenerateAnalysis sends a POST request", async () => {
    await api.regenerateAnalysis("uuid-1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/assets/uuid-1/regenerate-analysis");
    expect(init?.method).toBe("POST");
  });

  test("backfillAnalysis sends a POST request", async () => {
    await api.backfillAnalysis();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/assets/backfill-analysis");
    expect(init?.method).toBe("POST");
  });
});
