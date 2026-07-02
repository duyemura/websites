import { test, expect, describe } from "vitest";
import { build, authHeaders } from "../helper";
import { db } from "../../src/database";
import { jsonb } from "../../src/utils/jsonb";

describe("POST /sites/:uuid/build-commands", () => {
  test("returns 404 when site does not exist", async () => {
    const app = await build();

    const response = await app.inject({
      method: "POST",
      url: "/api/sites/00000000-0000-0000-0000-000000000000/build-commands",
      headers: authHeaders(),
      payload: { message: "edit the homepage" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Site not found" });

    await app.close();
  });

  test("recognizes edit homepage command", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Commands Gym", slug: "commands-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "commands-gym" },
      payload: { name: "Commands Site", slug: "home" },
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

    const response = await app.inject({
      method: "POST",
      url: `/api/sites/${siteUuid}/build-commands`,
      headers: { ...authHeaders(), "x-workspace-slug": "commands-gym" },
      payload: { message: "edit the homepage" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe("edit_page");
    expect(body.enqueued).toBe(true);

    await app.close();
  });

  test("recognizes approve and continue command", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Approve Gym", slug: "approve-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "approve-gym" },
      payload: { name: "Approve Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    await db
      .insertInto("docs")
      .values({
        workspaceUuid,
        siteUuid,
        key: "blueprint-draft",
        title: "Blueprint draft",
        content: `# Blueprint draft\n\n## Site blueprint\n\n\`\`\`json\n${JSON.stringify({
          site_metadata: { framework: "astro", mode: "replication", target_url: "https://example.com", generated_at: new Date().toISOString() },
          design_tokens: {},
          global_shell: {},
          pages: [],
          build_plan: { next_page: "about", page_status: { index: "built", about: "planned" }, build_order: ["index", "about"] },
        })}\n\`\`\``,
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
        steps: jsonb([{ name: "build_homepage", status: "completed" }]),
        options: jsonb({ accuracy: "accurate" }),
      })
      .execute();

    const response = await app.inject({
      method: "POST",
      url: `/api/sites/${siteUuid}/build-commands`,
      headers: { ...authHeaders(), "x-workspace-slug": "approve-gym" },
      payload: { message: "approve homepage and build the rest" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe("approve_page");
    expect(body.enqueued).toBe(true);

    await app.close();
  });

  test("recognizes publish site command", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Publish Gym", slug: "publish-gym" },
    });

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "publish-gym" },
      payload: { name: "Publish Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    await db
      .insertInto("deployments")
      .values({
        siteUuid,
        buildId: "attempt-publish",
        status: "success",
        previewUrl: "https://example.com/preview",
      })
      .execute();

    const response = await app.inject({
      method: "POST",
      url: `/api/sites/${siteUuid}/build-commands`,
      headers: { ...authHeaders(), "x-workspace-slug": "publish-gym" },
      payload: { message: "publish the site" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe("publish_page");
    expect(body.enqueued).toBe(true);

    await app.close();
  });

  test("unknown command returns helpful reply", async () => {
    const app = await build();

    await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Help Gym", slug: "help-gym" },
    });

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "help-gym" },
      payload: { name: "Help Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    const response = await app.inject({
      method: "POST",
      url: `/api/sites/${siteUuid}/build-commands`,
      headers: { ...authHeaders(), "x-workspace-slug": "help-gym" },
      payload: { message: "what is the meaning of life" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.action).toBe("help");
    expect(body.enqueued).toBe(false);
    expect(body.reply).toContain("Here's what I can help with today");

    await app.close();
  });
});
