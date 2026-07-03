import { describe, test, expect } from "vitest";
import { build, authHeaders } from "../helper";
import { db } from "../../src/database";
import { saveArtifact } from "../../src/utils/pipeline/artifact-store";

async function createSite(): Promise<{ siteUuid: string; workspaceUuid: string }> {
  const app = await build();
  try {
    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: authHeaders(),
      payload: { name: "Pipeline Site", slug: "pipeline-site" },
    });
    const siteUuid = site.json().uuid;
    const workspaceUuid = site.json().workspaceUuid;
    return { siteUuid, workspaceUuid };
  } finally {
    await app.close();
  }
}

describe("POST /sites/:uuid/pipeline/:stage", () => {
  test("enqueues an extract job and returns a job id", async () => {
    const { siteUuid } = await createSite();
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/sites/${siteUuid}/pipeline/extract`,
        payload: { url: "https://example.com", pages: ["/"] },
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().jobId).toBeDefined();
    } finally {
      await app.close();
    }
  });

  test("rejects an unknown stage", async () => {
    const { siteUuid } = await createSite();
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/sites/${siteUuid}/pipeline/paint`,
        payload: {},
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  test("returns 404 when the site does not belong to the workspace", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/sites/00000000-0000-0000-0000-000000000000/pipeline/extract`,
        payload: { url: "https://example.com" },
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("enqueues a pipeline-run job for all five stages", async () => {
    const { siteUuid } = await createSite();
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/sites/${siteUuid}/pipeline/run`,
        payload: { url: "https://example.com" },
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().jobId).toBeDefined();
    } finally {
      await app.close();
    }
  });
});

describe("GET /sites/:uuid/pipeline/status", () => {
  test("returns null for every stage when no artifacts exist", async () => {
    const { siteUuid } = await createSite();
    const app = await build();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/sites/${siteUuid}/pipeline/status`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stages.extract).toBeNull();
      expect(body.stages.segment).toBeNull();
      expect(body.stages.docgen).toBeNull();
      expect(body.stages.build).toBeNull();
      expect(body.stages.verify).toBeNull();
    } finally {
      await app.close();
    }
  });

  test("reports per-stage artifact versions and staleness", async () => {
    const { siteUuid, workspaceUuid } = await createSite();

    // extract v1 (old), extract v2 (new)
    await saveArtifact(
      db,
      { siteUuid, workspaceUuid },
      "extract",
      { extractedAt: "2026-06-01T00:00:00.000Z" },
    );
    await saveArtifact(
      db,
      { siteUuid, workspaceUuid },
      "extract",
      { extractedAt: "2026-07-01T00:00:00.000Z" },
    );

    // segment v1 that references the OLD extract → stale.
    await saveArtifact(
      db,
      { siteUuid, workspaceUuid },
      "segment",
      { sourceExtractAt: "2026-06-01T00:00:00.000Z" },
    );

    const app = await build();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/sites/${siteUuid}/pipeline/status`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stages.extract.version).toBe(2);
      expect(body.stages.segment.version).toBe(1);
      expect(body.stages.segment.stale).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("returns 404 when the site does not belong to the workspace", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/sites/00000000-0000-0000-0000-000000000000/pipeline/status`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
