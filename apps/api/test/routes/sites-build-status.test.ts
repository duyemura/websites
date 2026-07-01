import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";
import { db } from "../../src/database";
import { jsonb } from "../../src/utils/jsonb";

describe("GET /sites/:uuid/build-status", () => {
  test("returns 404 when site does not exist", async () => {
    const app = await build();

    const response = await app.inject({
      method: "GET",
      url: "/api/sites/00000000-0000-0000-0000-000000000000/build-status",
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Site not found" });

    await app.close();
  });

  test("returns latest aiJob, deployment, blueprint, and aiActivity for a populated site", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Build Status Gym", slug: "build-status-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "build-status-gym" },
      payload: { name: "Build Status Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    const aiJobUuid = crypto.randomUUID();
    await db
      .insertInto("aiJobs")
      .values({
        uuid: aiJobUuid,
        workspaceUuid,
        siteUuid,
        type: "replicate_site",
        status: "running",
        state: jsonb({ phase: "build", currentSlug: "index" }),
        steps: jsonb([{ name: "build_homepage", status: "in_progress" }]),
        options: jsonb({ accuracy: "accurate" }),
      })
      .execute();

    await db
      .insertInto("deployments")
      .values({
        siteUuid,
        buildId: "attempt-1",
        status: "success",
        previewUrl: "https://example.com/preview",
        artifactUrl: "https://example.com/artifact",
        metadata: { fidelityScore: 0.95 },
      })
      .execute();

    const blueprint = {
      site_metadata: { framework: "astro", mode: "replication", target_url: "https://example.com", generated_at: new Date().toISOString() },
      design_tokens: {},
      global_shell: {},
      pages: [],
      build_plan: { next_page: "", page_status: { index: "built" }, build_order: ["index"] },
    };

    await db
      .insertInto("docs")
      .values({
        workspaceUuid,
        siteUuid,
        key: "blueprint-draft",
        title: "Blueprint draft",
        content: `# Blueprint draft\n\n## Site blueprint\n\n\`\`\`json\n${JSON.stringify(blueprint, null, 2)}\n\`\`\``,
        source: "ai_extracted",
        status: "active",
      })
      .execute();

    await db
      .insertInto("aiActivity")
      .values({
        workspaceUuid,
        userUuid: "test-user",
        siteUuid,
        aiJobUuid,
        actionType: "generate",
        outcome: "success",
        summary: "Built homepage",
      })
      .execute();

    const response = await app.inject({
      method: "GET",
      url: `/api/sites/${siteUuid}/build-status`,
      headers: { ...authHeaders(), "x-workspace-slug": "build-status-gym" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.site.uuid).toBe(siteUuid);
    expect(body.aiJob?.uuid).toBe(aiJobUuid);
    expect(body.aiJob?.status).toBe("running");
    expect(body.deployment?.buildId).toBe("attempt-1");
    expect(body.deployment?.status).toBe("success");
    expect(body.blueprint?.build_plan.page_status.index).toBe("built");
    expect(body.aiActivity).toHaveLength(1);
    expect(body.aiActivity[0].summary).toBe("Built homepage");

    await app.close();
  });
});
