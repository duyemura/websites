import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";

describe("gmb routes", () => {
  test("GET /gmb/search returns 500 when Google Places API key is not configured", async () => {
    const originalKey = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;

    const app = await build();
    const response = await app.inject({
      method: "GET",
      url: "/api/gmb/search?q=Torrance%20Training%20Lab",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Google Places API key is not configured" });

    await app.close();

    if (originalKey) {
      process.env.GOOGLE_PLACES_API_KEY = originalKey;
    }
  });

  test("GET /gmb/search resolves Torrance Training Lab when a key is configured", async () => {
    if (!process.env.GOOGLE_PLACES_API_KEY) {
      // Skip this test when the key is not available; the missing-key case is covered above.
      return;
    }

    const app = await build();
    const response = await app.inject({
      method: "GET",
      url: "/api/gmb/search?q=Torrance%20Training%20Lab",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.places.length).toBeGreaterThan(0);
    expect(body.places[0].name).toBe("Torrance Training Lab");

    await app.close();
  });
});
