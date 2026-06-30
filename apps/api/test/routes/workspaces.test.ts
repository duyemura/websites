import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";

describe("workspace routes", () => {
  test("POST /workspaces creates a workspace", async () => {
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Acme Gym", slug: "acme-gym" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("Acme Gym");
    expect(body.slug).toBe("acme-gym");
    expect(body.status).toBe("active");

    await app.close();
  });

  test("GET /workspaces lists workspaces the user belongs to", async () => {
    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: "/api/workspaces",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);

    await app.close();
  });

  test("PUT /workspaces/:uuid updates workspace settings", async () => {
    const app = await build();

    const created = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Acme Gym", slug: "acme-gym" },
    });
    const uuid = created.json().uuid;

    const response = await app.inject({
      method: "PUT",
      url: `/api/workspaces/${uuid}`,
      headers: authHeaders(),
      payload: { name: "Acme Gym Premium", brandPrimaryColor: "#000000" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe("Acme Gym Premium");
    expect(body.brandPrimaryColor).toBe("#000000");

    await app.close();
  });

  test("POST /workspaces/:uuid/members adds a user", async () => {
    const app = await build();

    const created = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Acme Gym", slug: "acme-gym" },
    });
    const uuid = created.json().uuid;

    const response = await app.inject({
      method: "POST",
      url: `/api/workspaces/${uuid}/members`,
      headers: authHeaders(),
      payload: { email: "teammate@ploygyms.dev", role: "admin" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.email).toBe("teammate@ploygyms.dev");
    expect(body.role).toBe("admin");

    await app.close();
  });

  test("workspace scoping applies to sites and assets", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Acme Gym", slug: "acme-gym" },
    });
    await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: authHeaders(),
      payload: { name: "Acme Site", slug: "home" },
    });

    await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: {
        ...authHeaders(),
        "x-workspace-slug": "test-workspace",
      },
      payload: { name: "Other Site", slug: "home" },
    });

    const sites = await app.inject({
      method: "GET",
      url: "/api/sites",
      headers: authHeaders(),
    });

    expect(sites.statusCode).toBe(200);
    expect(sites.json()).toHaveLength(1);
    expect(sites.json()[0].name).toBe("Acme Site");

    await app.close();
  });
});
