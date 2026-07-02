import { describe, test, expect } from "vitest";
import { uploadBuildArtifacts } from "../build-artifacts";
import type { Config } from "../../plugins/env";

describe("build-artifacts", () => {
  test("uploadBuildArtifacts throws when deployments bucket is not configured", async () => {
    const config = {
      S3_DEPLOYMENTS_BUCKET: undefined,
      CDN_DEPLOYMENTS_BASE_URL: "https://cdn.example.com",
      CDN_BASE_URL: "https://cdn.example.com",
    } as unknown as Config;

    await expect(
      uploadBuildArtifacts({
        config,
        workspaceUuid: "ws-1",
        siteUuid: "site-1",
        attemptId: "attempt-1",
        pageSlug: "index",
        sourceDir: "/tmp/src",
        distDir: "/tmp/dist",
      }),
    ).rejects.toThrow("S3_DEPLOYMENTS_BUCKET is not configured");
  });

  test("uploadBuildArtifacts throws when dist directory is missing", async () => {
    const config = {
      S3_DEPLOYMENTS_BUCKET: "deployments",
      CDN_DEPLOYMENTS_BASE_URL: "https://cdn.example.com",
      CDN_BASE_URL: "https://cdn.example.com",
    } as unknown as Config;

    await expect(
      uploadBuildArtifacts({
        config,
        workspaceUuid: "ws-1",
        siteUuid: "site-1",
        attemptId: "attempt-1",
        pageSlug: "index",
        sourceDir: "/tmp/src",
        distDir: "/tmp/nonexistent-dist",
      }),
    ).rejects.toThrow("ENOENT");
  });
});
