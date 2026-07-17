import { describe, test, expect } from "vitest";
import { resolvePageComponents, type AstroComponent } from "./template-resolver";
import { beanburitoSpec } from "@milo/shared-types";
import type { GymSiteContent } from "../types/gym-content";

const dummyContent = {
  meta: { templateTheme: "beanburito" },
  business: { name: "Test Gym", primaryCta: { label: "Book", url: "/contact" }, serviceArea: [] },
  navigation: { header: [], footer: [] },
  pages: {
    home: {
      hero: { headline: "Home" },
      valueProps: [],
      programsHeadline: "Programs",
      featuredPrograms: [],
      features: [],
      communityHeadline: "",
      communityProps: [],
      trustHeadline: "",
      howItWorks: [],
      howItWorksHeadline: "",
      testimonials: [],
      faq: [],
      ctaHeadline: "",
    },
    about: {
      hero: { headline: "About" },
      gymStory: "",
      team: [{ name: "Alex", title: "Coach", photoUrl: "", bio: "" }],
      communityHeadline: "",
      communityProps: [],
      communityBody: "",
      story: { headline: "Our story", subheadline: "", imageUrl: "", imageAlt: "", blocks: [{ type: "text", html: "<p>x</p>" }] },
      ctaHeadline: "Book",
      faq: [{ question: "Q", answer: "A" }],
    },
    programs: [],
    pricing: { hero: { headline: "" } },
    contact: { hero: { headline: "" } },
    schedule: { hero: { headline: "" } },
    blog: { heroHeadline: "Blog", posts: [] },
    localGuide: { hero: { headline: "" }, sections: [], richContent: [] },
    legal: [],
  },
} as unknown as GymSiteContent;

const componentMap: Record<string, any> = {
  Hero: "Hero",
  Story: "Story",
  Community: "Community",
  teamBeanburito: "TeamBeanburito",
  TeamGrid: "TeamGrid",
  team: "TeamGrid",
  Testimonials: "Testimonials",
  FAQ: "FAQ",
  CTABand: "CTABand",
  Location: "Location",
};

describe("resolvePageComponents", () => {
  test("uses the spec's component field to resolve theme-specific wrappers", () => {
    const resolved = resolvePageComponents(beanburitoSpec, "about", dummyContent, componentMap);
    const ids = resolved.map((r) => r.componentId);
    const refs = resolved.map((r) => r.component);

    expect(ids).toContain("team");
    expect(refs).toContain("TeamBeanburito");
    expect(refs).not.toContain("TeamGrid");
  });

  test("falls back to the page slot id when the spec component is missing from the map", () => {
    const mapWithoutBeanburito = { ...componentMap, teamBeanburito: undefined } as unknown as Record<string, AstroComponent>;
    const resolved = resolvePageComponents(beanburitoSpec, "about", dummyContent, mapWithoutBeanburito);
    const team = resolved.find((r) => r.componentId === "team");
    expect(team?.component).toBe("TeamGrid");
  });
});
