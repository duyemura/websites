import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";

describe("organization routes", () => {
  test("POST /organizations creates an org and makes the creator owner", async () => {
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/api/organizations",
      headers: authHeaders(),
      payload: { name: "PushPress", slug: "pushpress" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe("PushPress");
    expect(body.slug).toBe("pushpress");
    expect(body.ownerUserUuid).toBeDefined();

    await app.close();
  });

  test("GET /organizations lists orgs the user belongs to", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/organizations",
      headers: authHeaders(),
      payload: { name: "PushPress", slug: "pushpress" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/organizations",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);

    await app.close();
  });

  test("POST /organizations/:uuid/members adds a user", async () => {
    const app = await build();

    const created = await app.inject({
      method: "POST",
      url: "/api/organizations",
      headers: authHeaders(),
      payload: { name: "PushPress", slug: "pushpress" },
    });
    const uuid = created.json().uuid;

    const response = await app.inject({
      method: "POST",
      url: `/api/organizations/${uuid}/members`,
      headers: authHeaders(),
      payload: { email: "member@milo.dev", name: "Member", role: "admin" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.email).toBe("member@milo.dev");
    expect(body.role).toBe("admin");

    await app.close();
  });
});
