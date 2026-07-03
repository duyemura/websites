import { describe, test, expect } from "vitest";
import { loadSiteHierarchyDoc, saveSiteHierarchyDoc } from "../site-hierarchy-io";
import { loadDesignSystemDoc } from "../design-system-io";
import { db } from "../../database";
import { build, authHeaders } from "../../../test/helper";
import type { SiteHierarchy } from "../../types/site-hierarchy";
import type { DesignSystemV2 } from "../../types/design-system-v2";

function makeHierarchy(): SiteHierarchy {
  return {
    version: "1",
    siteMetadata: { framework: "astro", mode: "replication", generatedAt: new Date().toISOString() },
    pages: [{ slug: "index", isHomePage: true, title: "Home", sections: [] }],
    buildPlan: { nextPage: "index", pageStatus: { index: "in_progress" }, buildOrder: ["index"] },
  };
}

function makeLegacyBlueprintDoc(workspaceUuid: string, siteUuid: string) {
  const blueprint = {
    site_metadata: {
      framework: "astro",
      mode: "replication",
      target_url: "https://legacy.example.com",
      business_name: "Legacy Gym",
      generated_at: new Date().toISOString(),
    },
    design_tokens: {
      colors: {
        primary: "#ff0000",
        primaryForeground: "#ffffff",
        background: "#ffffff",
        foreground: "#171717",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        border: "#e5e5e5",
      },
      fonts: { heading: "Inter", body: "Inter" },
      radius: "0.5rem",
    },
    global_shell: {
      theme: {
        colors: {
          primary: "#ff0000",
          primaryForeground: "#ffffff",
          background: "#ffffff",
          foreground: "#171717",
          muted: "#f5f5f5",
          mutedForeground: "#737373",
          border: "#e5e5e5",
        },
        fonts: { heading: "Inter", body: "Inter" },
        radius: "0.5rem",
      },
      navLinks: [{ label: "Home", href: "/" }],
      header: { id: "header", type: "SiteHeader", props: { logo: { type: "text", value: "Legacy Gym" } } },
      footer: { id: "footer", type: "SiteFooter", props: { businessName: "Legacy Gym" } },
    },
    brand_identity: {
      logo: { type: "text", value: "Legacy Gym" },
      heading_style: { uppercase: false, bold: true },
    },
    reference: { section_order: ["Hero"] },
    pages: [
      {
        slug: "index",
        isHomePage: true,
        title: "Home",
        sections: [
          { id: "hero-1", type: "Hero", props: { title: "Train", subtitle: "Get fit", cta: { label: "Join", href: "#join" } } },
        ],
      },
    ],
    build_plan: {
      next_page: "index",
      page_status: { index: "in_progress" },
      build_order: ["index"],
    },
  };

  return {
    workspaceUuid,
    siteUuid,
    key: "blueprint-draft",
    title: "Blueprint draft",
    content: `# Blueprint draft\n\n## Site blueprint\n\n\`\`\`json\n${JSON.stringify(blueprint, null, 2)}\n\`\`\``,
    source: "ai_extracted" as const,
    status: "active" as const,
  };
}

describe("loadSiteHierarchyDoc migration", () => {
  test("migrates a legacy blueprint-draft doc when site-hierarchy is missing", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Migration Gym", slug: "migration-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "migration-gym" },
      payload: { name: "Migration Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    await db.insertInto("docs").values(makeLegacyBlueprintDoc(workspaceUuid, siteUuid)).execute();

    const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);

    expect(hierarchy).not.toBeNull();
    expect(hierarchy?.siteMetadata.businessName).toBe("Legacy Gym");
    expect(hierarchy?.pages[0]?.slug).toBe("index");
    expect(hierarchy?.pages[0]?.sections[0]?.tag).toBe("hero");
    expect(hierarchy?.pages[0]?.sections[0]?.content.heading).toBe("Train");
    expect(hierarchy?.pages[0]?.sections[0]?.evidenceId).toBe("legacy-index-hero-1");

    const designSystem = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
    expect(designSystem).not.toBeNull();
    expect((designSystem as DesignSystemV2).global.tokens.colors.primary).toBe("#ff0000");
    expect((designSystem as DesignSystemV2).global.shell.header).toBeDefined();

    await app.close();
  });

  test("returns existing site-hierarchy doc without migrating", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Migration Skip Gym", slug: "migration-skip-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "migration-skip-gym" },
      payload: { name: "Migration Skip Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, makeHierarchy());
    await db.insertInto("docs").values(makeLegacyBlueprintDoc(workspaceUuid, siteUuid)).execute();

    const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
    expect(hierarchy?.pages[0]?.title).toBe("Home");

    await app.close();
  });
});
