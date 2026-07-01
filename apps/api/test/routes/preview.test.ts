import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";
import { db } from "../../src/database";

describe("preview routes", () => {
  test("GET /sites/:uuid/preview/:attemptId is public and redirects to the deployment preview URL", async () => {
    const app = await build();

    const created = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: authHeaders(),
      payload: { name: "Preview Test", slug: "preview-test" },
    });
    const site = created.json();

    await db
      .insertInto("deployments")
      .values({
        siteUuid: site.uuid,
        buildId: "test-attempt-1",
        status: "success",
        previewUrl: "https://cdn.example.com/preview/index.html",
        artifactUrl: "https://cdn.example.com/preview/",
      })
      .execute();

    const response = await app.inject({
      method: "GET",
      url: `/api/sites/${site.uuid}/preview/test-attempt-1`,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "https://cdn.example.com/preview/index.html",
    );

    await app.close();
  });

  test("GET /sites/:uuid/preview/:attemptId/subpath still requires authentication", async () => {
    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: "/api/sites/00000000-0000-0000-0000-000000000000/preview/attempt/extra",
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  test("unauthenticated requests outside the preview pattern still require auth", async () => {
    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: "/api/sites/00000000-0000-0000-0000-000000000000/preview/",
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });
});
