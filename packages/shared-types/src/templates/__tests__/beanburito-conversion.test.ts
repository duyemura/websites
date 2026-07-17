import { describe, test, expect } from "vitest";
import { beanburitoSpec, buildPageSpecPrompt } from "../beanburito.js";

describe("beanburito conversion metadata", () => {
  test("every page declares a goal and ideal action", () => {
    for (const [key, page] of Object.entries(beanburitoSpec.pages)) {
      expect(page.goal, `${key} page should declare a goal`).toBeTruthy();
      expect(page.idealAction, `${key} page should declare an ideal action`).toBeTruthy();
    }
  });

  test("home page has full conversion brief metadata", () => {
    const home = beanburitoSpec.pages.home;
    expect(home.visitorStage).toBe("awareness");
    expect(home.searchIntent).toBe("local");
    expect(home.objectionsToOvercome?.length).toBeGreaterThan(0);
    expect(home.evidenceTypes?.length).toBeGreaterThan(0);
    expect(home.seoPrimaryQuery).toBeTruthy();
  });

  test("about page includes trust and story evidence", () => {
    const about = beanburitoSpec.pages.about;
    expect(about.evidenceTypes).toContain("founder story");
    expect(about.evidenceTypes).toContain("coach bios and photos");
    expect(about.contentSignals).toContain("founderStory");
    expect(about.contentSignals).toContain("teamMembers");
  });

  test("buildPageSpecPrompt renders conversion brief", () => {
    const prompt = buildPageSpecPrompt(beanburitoSpec, "home");
    expect(prompt).toContain("PAGE GOAL:");
    expect(prompt).toContain("IDEAL ACTION:");
    expect(prompt).toContain("VISITOR STAGE:");
    expect(prompt).toContain("SEARCH INTENT:");
    expect(prompt).toContain("OBJECTIONS TO OVERCOME:");
    expect(prompt).toContain("EVIDENCE TO USE:");
    expect(prompt).toContain("SEO PRIMARY QUERY:");
  });

  test("buildPageSpecPrompt returns empty for unknown page", () => {
    expect(buildPageSpecPrompt(beanburitoSpec, "nope")).toBe("");
  });

  test("about page prompt includes spec sections and conversion brief", () => {
    const prompt = buildPageSpecPrompt(beanburitoSpec, "about");
    expect(prompt).toContain("PAGE GOAL: Earn trust");
    expect(prompt).toContain("IDEAL ACTION: Book a free intro or visit");
    expect(prompt).toContain("SECTION: HERO");
    expect(prompt).toContain("SECTION: STORY");
    expect(prompt).toContain("SECTION: TEAM");
    expect(prompt).toContain("SECTION: CTABAND");
  });

  test("program page prompt is tailored to program archetype", () => {
    const prompt = buildPageSpecPrompt(beanburitoSpec, "program");
    expect(prompt).toContain("PAGE GOAL: Help a visitor decide");
    expect(prompt).toContain("IDEAL ACTION: Book a free class or trial");
    expect(prompt).toContain("VISITOR STAGE: consideration");
    expect(prompt).toContain("SEO PRIMARY QUERY: [program name] classes in [city]");
  });
});
