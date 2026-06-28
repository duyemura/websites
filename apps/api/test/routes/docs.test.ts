import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";

describe("docs routes", () => {
  test("POST /docs creates a doc", async () => {
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Gym story", content: "# Our story" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.key).toBe("gym-story");
    expect(body.title).toBe("Gym story");
    expect(body.status).toBe("active");
    expect(body.content).toBe("# Our story");

    await app.close();
  });

  test("POST /docs rejects duplicate keys", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Gym story" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Gym story" },
    });

    expect(response.statusCode).toBe(409);

    await app.close();
  });

  test("GET /docs lists active docs and excludes archived", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Visible" },
    });

    const archived = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Archived", key: "archived" },
    });
    const archivedKey = archived.json().key;

    await app.inject({
      method: "POST",
      url: `/api/docs/${archivedKey}/archive`,
      headers: authHeaders(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/docs",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const docs = response.json();
    expect(docs).toHaveLength(1);
    expect(docs[0].key).toBe("visible");

    await app.close();
  });

  test("PUT /docs/:key updates a doc", async () => {
    const app = await build();

    const created = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Original" },
    });
    const key = created.json().key;

    const response = await app.inject({
      method: "PUT",
      url: `/api/docs/${key}`,
      headers: authHeaders(),
      payload: { title: "Updated", content: "New body" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.title).toBe("Updated");
    expect(body.content).toBe("New body");

    await app.close();
  });

  test("POST /docs/:key/archive and /restore toggle status", async () => {
    const app = await build();

    const created = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Toggle me" },
    });
    const key = created.json().key;

    const archived = await app.inject({
      method: "POST",
      url: `/api/docs/${key}/archive`,
      headers: authHeaders(),
    });
    expect(archived.json().status).toBe("archived");

    const restored = await app.inject({
      method: "POST",
      url: `/api/docs/${key}/restore`,
      headers: authHeaders(),
    });
    expect(restored.json().status).toBe("active");

    await app.close();
  });

  test("DELETE /docs/:key removes a doc", async () => {
    const app = await build();

    const created = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Delete me" },
    });
    const key = created.json().key;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/docs/${key}`,
      headers: authHeaders(),
    });
    expect(deleted.statusCode).toBe(204);

    const list = await app.inject({
      method: "GET",
      url: "/api/docs",
      headers: authHeaders(),
    });
    expect(list.json()).toHaveLength(0);

    await app.close();
  });
});
