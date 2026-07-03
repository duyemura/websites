import { describe, test, expect } from "vitest";
import { migrateBlueprintToHierarchy } from "../site-hierarchy-migrate";
import type { SiteBlueprint } from "../site-blueprint";

function makeBlueprint(): SiteBlueprint {
  return {
    site_metadata: {
      framework: "astro",
      mode: "replication",
      target_url: "https://example.com",
      business_name: "Legacy Gym",
      generated_at: "2026-07-01T00:00:00.000Z",
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
      fonts: {
        heading: "Inter",
        body: "Inter",
      },
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
        fonts: {
          heading: "Inter",
          body: "Inter",
        },
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
    reference: { section_order: ["Hero", "Text", "SiteCardGroup"] },
    pages: [
      {
        slug: "index",
        isHomePage: true,
        title: "Home",
        metaTitle: "Legacy Gym",
        metaDescription: "A great gym.",
        primaryCta: { label: "Join", href: "#join" },
        sections: [
          { id: "hero-1", type: "Hero", props: { title: "Train hard", subtitle: "Get results", cta: { label: "Join", href: "#join" } } },
          { id: "text-1", type: "Text", props: { heading: "About", body: "We are a gym." } },
          { id: "cards-1", type: "SiteCardGroup", props: { items: [{ title: "CrossFit", description: "Functional fitness" }] } },
        ],
      },
      {
        slug: "about",
        isHomePage: false,
        title: "About",
        sections: [],
      },
    ],
    build_plan: {
      next_page: "about",
      page_status: { index: "built", about: "planned" },
      build_order: ["index", "about"],
    },
  } as unknown as SiteBlueprint;
}

describe("migrateBlueprintToHierarchy", () => {
  test("converts legacy blueprint to site hierarchy v1", () => {
    const blueprint = makeBlueprint();
    const { hierarchy } = migrateBlueprintToHierarchy(blueprint);

    expect(hierarchy.version).toBe("1");
    expect(hierarchy.siteMetadata.mode).toBe("replication");
    expect(hierarchy.siteMetadata.businessName).toBe("Legacy Gym");
    expect(hierarchy.pages).toHaveLength(2);

    const home = hierarchy.pages[0];
    expect(home?.slug).toBe("index");
    expect(home?.primaryCta).toEqual({ label: "Join", href: "#join" });

    const hero = home?.sections.find((s) => s.tag === "hero");
    expect(hero).toBeDefined();
    expect(hero?.content.heading).toBe("Train hard");
    expect(hero?.content.cta).toEqual({ label: "Join", href: "#join" });
    expect(hero?.evidenceId).toBe("legacy-index-hero-1");

    const contentBlock = home?.sections.find((s) => s.tag === "content-block");
    expect(contentBlock?.content.heading).toBe("About");

    const featureGrid = home?.sections.find((s) => s.tag === "feature-grid");
    expect(featureGrid?.content.items).toHaveLength(1);

    expect(hierarchy.buildPlan.pageStatus).toEqual({ index: "built", about: "planned" });
    expect(hierarchy.buildPlan.buildOrder).toEqual(["index", "about"]);
  });

  test("converts legacy blueprint to design-system v2", () => {
    const blueprint = makeBlueprint();
    const { designSystem } = migrateBlueprintToHierarchy(blueprint);

    expect(designSystem.version).toBe("2");
    expect(designSystem.global.tokens.colors.primary).toBe("#ff0000");
    expect(designSystem.global.shell.header).toBeDefined();
    expect(designSystem.global.shell.footer).toBeDefined();
    expect(designSystem.global.shell.navLinks).toEqual([{ label: "Home", href: "/" }]);
    expect(designSystem.brand.logo).toEqual({ type: "text", value: "Legacy Gym" });
    expect(designSystem.reference.homePagePrimaryCta).toEqual({ label: "Join", href: "#join" });
  });

  test("header and footer sections become unknown content sections", () => {
    const blueprint = makeBlueprint();
    const { hierarchy } = migrateBlueprintToHierarchy(blueprint);

    expect(hierarchy.pages[0]?.sections.some((s) => s.tag === "header")).toBe(false);
    expect(hierarchy.pages[0]?.sections.some((s) => s.tag === "footer")).toBe(false);
  });

  test("drops legacy header and footer sections from page sections", () => {
    const blueprint = makeBlueprint();
    const page = blueprint.pages[0] as unknown as {
      sections: { id: string; type: string; props?: Record<string, unknown> }[];
    };
    page.sections = [
      { id: "hdr", type: "SiteHeader", props: { logo: { type: "text", value: "X" } } },
      { id: "ftr", type: "SiteFooter", props: { businessName: "X" } },
      { id: "hero-2", type: "Hero", props: { title: "Welcome" } },
    ];

    const { hierarchy, designSystem } = migrateBlueprintToHierarchy(blueprint);

    expect(hierarchy.pages[0]?.sections.map((s) => s.tag)).toEqual(["hero"]);
    expect(designSystem.global.shell.header).toBeDefined();
    expect(designSystem.global.shell.footer).toBeDefined();
  });

  test("maps unknown section types to unknown content sections", () => {
    const blueprint = makeBlueprint();
    const page = blueprint.pages[0] as unknown as {
      sections: { id: string; type: string; props?: Record<string, unknown> }[];
    };
    page.sections = [
      { id: "map-1", type: "Map", props: { heading: "Find us" } },
      { id: "calendar-1", type: "EventCalendar", props: { title: "Schedule" } },
    ];
    const { hierarchy } = migrateBlueprintToHierarchy(blueprint);

    expect(hierarchy.pages[0]?.sections[0]?.tag).toBe("unknown");
    expect(hierarchy.pages[0]?.sections[1]?.tag).toBe("unknown");
    expect(hierarchy.pages[0]?.sections[0]?.content.heading).toBe("Find us");
  });

  test("ignores malformed CTAs", () => {
    const blueprint = makeBlueprint();
    const page = blueprint.pages[0] as unknown as {
      sections: { id: string; type: string; props?: Record<string, unknown> }[];
    };
    page.sections[0] = {
      id: "hero-bad-cta",
      type: "Hero",
      props: { title: "Train", cta: { label: "Join" } },
    };
    const { hierarchy, designSystem } = migrateBlueprintToHierarchy(blueprint);

    expect(hierarchy.pages[0]?.sections[0]?.content.cta).toBeUndefined();
    expect(designSystem.reference.homePagePrimaryCta).toBeNull();
  });

  test("tolerates missing business name, target url, header, and footer", () => {
    const blueprint = makeBlueprint();
    blueprint.site_metadata.business_name = undefined;
    blueprint.site_metadata.target_url = "";
    blueprint.global_shell.header = undefined;
    blueprint.global_shell.footer = undefined;

    const { hierarchy, designSystem } = migrateBlueprintToHierarchy(blueprint);

    expect(hierarchy.siteMetadata.businessName).toBeUndefined();
    expect(hierarchy.siteMetadata.targetUrl).toBe("");
    expect(designSystem.business.name).toBeUndefined();
    expect(designSystem.global.shell.header).toBeUndefined();
    expect(designSystem.global.shell.footer).toBeUndefined();
  });

  test("preserves hero style hints and eyebrow from legacy props", () => {
    const blueprint = makeBlueprint();
    const page = blueprint.pages[0] as unknown as {
      sections: { id: string; type: string; props?: Record<string, unknown> }[];
    };
    page.sections[0] = {
      id: "hero-1",
      type: "Hero",
      props: {
        title: "Train hard",
        subtitle: "Get results",
        cta: { label: "Join", href: "#join" },
        styleHint: { heroTextColor: "#ffffff", align: "left", eyebrow: "Welcome" },
      },
    };

    const { hierarchy } = migrateBlueprintToHierarchy(blueprint);
    const hero = hierarchy.pages[0]?.sections.find((s) => s.tag === "hero");

    expect(hero).toBeDefined();
    expect(hero?.styleHint?.heroTextColor).toBe("#ffffff");
    expect(hero?.styleHint?.align).toBe("left");
    expect(hero?.content.eyebrow).toBe("Welcome");
  });
});
