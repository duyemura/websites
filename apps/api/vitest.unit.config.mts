import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--import", "tsx"],
      },
    },
    testTimeout: 20000,
  },
});
