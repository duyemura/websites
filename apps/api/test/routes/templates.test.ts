import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";

describe("templates routes", () => {
  test("POST /templates/from-url rejects non-HTTP(S) URLs", async () => {
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/api/templates/from-url",
      headers: authHeaders(),
      payload: { url: "file:///etc/passwd" },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
