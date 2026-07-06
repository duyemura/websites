import { describe, test, expect, vi } from "vitest";
import { build, authHeaders } from "../helper";
import { db } from "../../src/database";
import { jsonb } from "../../src/utils/jsonb";

describe("POST /sites/:uuid/pages/:slug/approve", () => {
  test("approves the homepage and enqueues remaining planned pages", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Approve Route Gym", slug: "approve-route-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "approve-route-gym" },
      payload: { name: "Approve Route Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    const hierarchy = {
      version: "1",
      siteMetadata: {
        framework: "astro",
        mode: "replication",
        targetUrl: "https://example.com",
        generatedAt: new Date().toISOString(),
      },
      pages: [
        {
          slug: "index",
          isHomePage: true,
          title: "Home",
          sections: [],
        },
        {
          slug: "about",
          isHomePage: false,
          title: "About",
          sections: [],
        },
        {
          slug: "contact",
          isHomePage: false,
          title: "Contact",
          sections: [],
        },
      ],
      buildPlan: {
        nextPage: "about",
        pageStatus: { index: "built", about: "planned", contact: "planned" },
        buildOrder: ["index", "about", "contact"],
      },
    };

    await db
      .insertInto("docs")
      .values({
        workspaceUuid,
        siteUuid,
        key: "site-hierarchy",
        title: "Site hierarchy",
        content: `# Site hierarchy\n\n## Site hierarchy\n\n\`\`\`json\n${JSON.stringify(hierarchy, null, 2)}\n\`\`\``,
        source: "ai_extracted",
        status: "active",
      })
      .execute();

    const aiJobUuid = crypto.randomUUID();
    await db
      .insertInto("aiJobs")
      .values({
        uuid: aiJobUuid,
        workspaceUuid,
        siteUuid,
        type: "replicate_site",
        status: "running",
        state: jsonb({ phase: "review", currentSlug: "index" }),
        steps: jsonb([{ name: "build_index", status: "completed" }]),
        options: jsonb({ accuracy: "accurate" }),
      })
      .execute();

    const addSpy = vi.spyOn(app.queues.generatePage.queue, "add").mockResolvedValue({
      id: "queued-job",
      name: "generate_page",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: `/api/sites/${siteUuid}/pages/index/approve`,
      headers: { ...authHeaders(), "x-workspace-slug": "approve-route-gym" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.approved).toBe("index");
    expect(body.remainingPagesEnqueued).toEqual(["about", "contact"]);

    expect(addSpy).toHaveBeenCalledTimes(2);
    const slugs = addSpy.mock.calls.map((call) => (call[1] as { pageSlug: string }).pageSlug);
    expect(slugs).toEqual(["about", "contact"]);

    addSpy.mockRestore();
    await app.close();
  });

  test("returns 409 when the page is not built", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Approve Conflict Gym", slug: "approve-conflict-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "approve-conflict-gym" },
      payload: { name: "Approve Conflict Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    const hierarchy = {
      version: "1",
      siteMetadata: {
        framework: "astro",
        mode: "replication",
        targetUrl: "https://example.com",
        generatedAt: new Date().toISOString(),
      },
      pages: [
        {
          slug: "index",
          isHomePage: true,
          title: "Home",
          sections: [],
        },
      ],
      buildPlan: {
        nextPage: "index",
        pageStatus: { index: "planned" },
        buildOrder: ["index"],
      },
    };

    await db
      .insertInto("docs")
      .values({
        workspaceUuid,
        siteUuid,
        key: "site-hierarchy",
        title: "Site hierarchy",
        content: `# Site hierarchy\n\n## Site hierarchy\n\n\`\`\`json\n${JSON.stringify(hierarchy, null, 2)}\n\`\`\``,
        source: "ai_extracted",
        status: "active",
      })
      .execute();

    const response = await app.inject({
      method: "POST",
      url: `/api/sites/${siteUuid}/pages/index/approve`,
      headers: { ...authHeaders(), "x-workspace-slug": "approve-conflict-gym" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("not built yet");

    await app.close();
  });
});
