import { describe, test, expect } from "vitest";
import { updatePageStatus, pageBySlug, remainingPlannedSlugs } from "../blueprint-io";
import type { SiteBlueprint } from "../site-blueprint";
import type { TemplateShellPage } from "@milo/shared-types";

const makeBlueprint = (overrides?: Partial<SiteBlueprint>): SiteBlueprint => {
  const pageStatus: Record<string, SiteBlueprint["build_plan"]["page_status"][string]> = {
    index: "built",
    about: "planned",
    services: "planned",
    contact: "built",
  };

  const pages: TemplateShellPage[] = [
    { slug: "index", isHomePage: true, title: "Home", metaTitle: "Home", metaDescription: "", sections: [] },
    { slug: "about", isHomePage: false, title: "About", metaTitle: "About", metaDescription: "", sections: [] },
    { slug: "services", isHomePage: false, title: "Services", metaTitle: "Services", metaDescription: "", sections: [] },
    { slug: "contact", isHomePage: false, title: "Contact", metaTitle: "Contact", metaDescription: "", sections: [] },
  ];

  return {
    site_metadata: {
      framework: "astro",
      mode: "replication",
      target_url: "https://example.com",
      generated_at: "2026-07-01T00:00:00.000Z",
    },
    design_tokens: {
      colors: {
        primary: "#111111",
        primaryForeground: "#ffffff",
        background: "#ffffff",
        foreground: "#171717",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        border: "#e5e5e5",
      },
      fonts: { heading: "Sans-serif", body: "Sans-serif" },
      radius: "0.5rem",
    },
    global_shell: { theme: {} as never, navLinks: [] },
    pages,
    build_plan: {
      next_page: "about",
      page_status: pageStatus,
      build_order: ["index", "about", "services", "contact"],
    },
    ...overrides,
  } as SiteBlueprint;
};

describe("blueprint-io", () => {
  test("updatePageStatus mutates status for a slug", () => {
    const blueprint = makeBlueprint();
    const updated = updatePageStatus(blueprint, "about", "in_progress");
    expect(updated.build_plan.page_status.about).toBe("in_progress");
    expect(updated.build_plan.page_status.index).toBe("built");
  });

  test("updatePageStatus clears next_page when it matches the updated slug and status is not in_progress", () => {
    const blueprint = makeBlueprint();
    const updated = updatePageStatus(blueprint, "about", "built");
    expect(updated.build_plan.next_page).toBe("");
  });

  test("pageBySlug returns the matching page", () => {
    const blueprint = makeBlueprint();
    expect(pageBySlug(blueprint, "services")?.title).toBe("Services");
    expect(pageBySlug(blueprint, "missing")).toBeUndefined();
  });

  test("remainingPlannedSlugs returns planned pages after the given slug", () => {
    const blueprint = makeBlueprint();
    expect(remainingPlannedSlugs(blueprint, "index")).toEqual(["about", "services"]);
    expect(remainingPlannedSlugs(blueprint, "about")).toEqual(["services"]);
    expect(remainingPlannedSlugs(blueprint, "contact")).toEqual([]);
  });

  test("remainingPlannedSlugs ignores already built pages", () => {
    const blueprint = makeBlueprint();
    expect(remainingPlannedSlugs(blueprint, "services")).toEqual([]);
  });
});
