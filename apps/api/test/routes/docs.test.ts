import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";

describe("docs routes", () => {
  test("POST /docs creates a doc", async () => {
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Business info", content: "# Our story", key: "business-info" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.key).toBe("business-info");
    expect(body.title).toBe("Business info");
    expect(body.status).toBe("active");
    expect(body.content).toBe("# Our story");

    await app.close();
  });

  test("POST /docs rejects disallowed keys", async () => {
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Random", key: "random-doc" },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  test("POST /docs rejects duplicate keys", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Business info", key: "business-info" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Business info", key: "business-info" },
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
      payload: { title: "Business info", key: "business-info" },
    });

    await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Site strategy", key: "site-strategy" },
    });

    await app.inject({
      method: "POST",
      url: "/api/docs/site-strategy/archive",
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
    expect(docs[0].key).toBe("business-info");

    await app.close();
  });

  test("PUT /docs/:key updates a doc", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Business info", key: "business-info" },
    });

    const response = await app.inject({
      method: "PUT",
      url: "/api/docs/business-info",
      headers: authHeaders(),
      payload: { title: "Updated", content: "New body" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.title).toBe("Updated");
    expect(body.content).toBe("New body");

    await app.close();
  });

  test("PUT /docs/:key rejects disallowed keys", async () => {
    const app = await build();

    const response = await app.inject({
      method: "PUT",
      url: "/api/docs/random-doc",
      headers: authHeaders(),
      payload: { title: "Updated" },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  test("POST /docs/:key/archive and /restore toggle status", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Business info", key: "business-info" },
    });

    const archived = await app.inject({
      method: "POST",
      url: "/api/docs/business-info/archive",
      headers: authHeaders(),
    });
    expect(archived.json().status).toBe("archived");

    const restored = await app.inject({
      method: "POST",
      url: "/api/docs/business-info/restore",
      headers: authHeaders(),
    });
    expect(restored.json().status).toBe("active");

    await app.close();
  });

  test("DELETE /docs/:key removes a doc", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/docs",
      headers: authHeaders(),
      payload: { title: "Business info", key: "business-info" },
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/docs/business-info",
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

  test("DELETE /docs/:key rejects disallowed keys", async () => {
    const app = await build();

    const response = await app.inject({
      method: "DELETE",
      url: "/api/docs/random-doc",
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
