import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./test/globalSetup.ts",
    setupFiles: "./test/setup.ts",
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--import", "tsx"],
      },
    },
    coverage: {
      provider: "v8",
    },
  },
});
