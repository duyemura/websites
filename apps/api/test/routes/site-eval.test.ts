import { describe, test, expect } from "vitest";
import { build, authHeaders } from "../helper";
import { finalizeReport } from "../../src/services/eval/page-eval-report.js";

describe("POST /sites/:uuid/eval", () => {
  test("enqueues a per-page eval and returns a job id", async () => {
    const app = await build();
    try {
      await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: authHeaders(),
        payload: { name: "Eval Gym", slug: "eval-gym" },
      });

      const site = await app.inject({
        method: "POST",
        url: "/api/sites",
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym" },
        payload: { name: "Eval Site", slug: "eval-site" },
      });
      expect(site.statusCode).toBe(201);
      const siteUuid = site.json().uuid;

      const res = await app.inject({
        method: "POST",
        url: `/api/sites/${siteUuid}/eval`,
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym" },
        payload: { path: "/", url: "https://example.com" },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.evalUuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.jobId).toBeDefined();
      expect(body.status).toBe("queued");
      expect(body.path).toBe("/");

      // List endpoint returns the queued eval.
      const list = await app.inject({
        method: "GET",
        url: `/api/sites/${siteUuid}/evals`,
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym" },
      });
      expect(list.statusCode).toBe(200);
      const listBody = list.json();
      expect(listBody.evals).toHaveLength(1);
      expect(listBody.evals[0].uuid).toBe(body.evalUuid);
      expect(listBody.evals[0].status).toBe("queued");
      expect(listBody.evals[0].path).toBe("/");

      // Status endpoint returns the queued eval.
      const status = await app.inject({
        method: "GET",
        url: `/api/evals/${body.evalUuid}/status`,
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym" },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json().status).toBe("queued");

      // Detail endpoint returns a report-shaped fallback for the queued eval.
      const detail = await app.inject({
        method: "GET",
        url: `/api/evals/${body.evalUuid}`,
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym" },
      });
      expect(detail.statusCode).toBe(200);
      const report = detail.json();
      expect(report.overall.status).toBe("failed"); // not yet run
      expect(report.metadata.path).toBe("/");
    } finally {
      await app.close();
    }
  });

  test("returns 404 for a site outside the workspace", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sites/00000000-0000-0000-0000-000000000000/eval",
        headers: authHeaders(),
        payload: { path: "/", url: "https://example.com" },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("allows overriding the page URL and supplying keywords", async () => {
    const app = await build();
    try {
      await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: authHeaders(),
        payload: { name: "Eval Gym 2", slug: "eval-gym-2" },
      });

      const site = await app.inject({
        method: "POST",
        url: "/api/sites",
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym-2" },
        payload: { name: "Eval Site 2", slug: "eval-site-2" },
      });
      const siteUuid = site.json().uuid;

      const res = await app.inject({
        method: "POST",
        url: `/api/sites/${siteUuid}/eval`,
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym-2" },
        payload: {
          path: "/about",
          url: "https://example.org/about",
          keywords: ["CrossFit", "Denver"],
        },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json().path).toBe("/about");
    } finally {
      await app.close();
    }
  });

  test("GET /evals/:uuid/report.md returns a markdown report when a report exists", async () => {
    const app = await build();
    try {
      await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: authHeaders(),
        payload: { name: "Eval Gym 3", slug: "eval-gym-3" },
      });

      const site = await app.inject({
        method: "POST",
        url: "/api/sites",
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym-3" },
        payload: { name: "Eval Site 3", slug: "eval-site-3" },
      });
      const siteUuid = site.json().uuid;
      const workspaceUuid = site.json().workspaceUuid;

      const report = finalizeReport(
        [
          {
            name: "seo",
            score: 85,
            grade: "B",
            status: "passed",
            issues: [{ severity: "minor", category: "seo", message: "short meta", fix: "Expand meta" }],
          },
        ],
        { url: "https://example.com/", path: "/", title: "Home", h1: "Welcome", wordCount: 120, loadTimeMs: 600 },
      );

      const insert = await app.db
        .insertInto("siteEvals")
        .values({
          siteUuid,
          workspaceUuid,
          status: "passed",
          report: JSON.stringify(report),
          pages: JSON.stringify([{ path: "/", score: report.overall.score }]),
          formStatus: `${report.overall.score}/100 ${report.overall.grade}`,
          completedAt: new Date().toISOString(),
        })
        .returning("uuid")
        .executeTakeFirstOrThrow();

      const res = await app.inject({
        method: "GET",
        url: `/api/evals/${insert.uuid}/report.md`,
        headers: { ...authHeaders(), "x-workspace-slug": "eval-gym-3" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/markdown");
      expect(res.payload).toContain("# Page QA Report");
      expect(res.payload).toContain(report.overall.clientSummary);
    } finally {
      await app.close();
    }
  });
});
