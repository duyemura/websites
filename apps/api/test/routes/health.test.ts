import { test, expect } from "vitest";
import { build } from "../helper";

test("health route returns ok", async () => {
  const app = await build();
  const res = await app.inject({ url: "/health" });
  expect(res.json()).toEqual({ status: "ok" });
  await app.close();
});
