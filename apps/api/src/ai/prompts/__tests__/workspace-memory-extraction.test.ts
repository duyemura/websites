import { describe, test, expect } from "vitest";
import {
  loadWorkspaceMemoryExtractionTemplate,
  loadIcpStandard,
  buildCorpusInput,
} from "../workspace-memory-extraction";
import type { ScrapedWebsiteData } from "../../../utils/scrape-docs";

const baseScrape: ScrapedWebsiteData = {
  url: "https://example-gym.com",
  title: "Beta Gym",
  description: "A community gym for functional fitness.",
  businessName: "Beta Gym",
  tagline: "Stronger together.",
  headings: ["Train with purpose", "Join today"],
  paragraphs: ["We build fitness for real life."],
  buttons: ["Book a class"],
  navLinks: [],
  colors: [],
  fonts: [],
  fontSizes: [],
  images: [],
  layoutRules: [],
  faqs: [],
  testimonials: [{ quote: "Best gym in town.", author: "Jane D." }],
  locations: [],
  team: [{ name: "Coach Alex", role: "Head coach", bio: "CSCS certified." }],
  offerings: [{ name: "Group class", description: "One hour", price: "$30" }],
  contact: {},
};

describe("workspace-memory-extraction prompts", () => {
  test("loads extraction template", () => {
    const template = loadWorkspaceMemoryExtractionTemplate();
    expect(template).toContain("Workspace Memory Extraction");
    expect(template).toContain("industry");
    expect(template).toContain("targetMembers");
    expect(template).toContain("differentiators");
  });

  test("loads ICP standard", () => {
    const standard = loadIcpStandard();
    expect(standard).toContain("ICP Standard");
    expect(standard).toContain("jobsToBeDone");
    expect(standard).toContain("entrySignals");
  });

  test("corpus input includes all source fields", () => {
    const input = (buildCorpusInput as unknown as (data: ScrapedWebsiteData, gmb: undefined, industry: string) => string)(baseScrape, undefined, "fitness / gym");
    expect(input).toContain("Beta Gym");
    expect(input).toContain("Stronger together");
    expect(input).toContain("Train with purpose");
    expect(input).toContain("Group class");
    expect(input).toContain("Best gym in town");
    expect(input).toContain("Coach Alex");
  });
});
