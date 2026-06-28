import { test, expect } from "vitest";
import { build } from "./helper";

test("debug app build", async () => {
  const app = await build();
  expect(app.config).toBeDefined();
  expect(app.config.SERVICE).toBe("api");
  await app.close();
});
