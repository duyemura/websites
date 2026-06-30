import { describe, test, expect } from "vitest";
import {
  generateWorkspaceMemory,
  renderWorkspaceMemory,
} from "../../src/utils/workspace-memory";
import type { ScrapedWebsiteData } from "../../src/utils/scrape-docs";

const baseScrape: ScrapedWebsiteData = {
  url: "https://example-gym.com",
  title: "Beta Gym - Functional Fitness",
  description: "A community gym for functional fitness.",
  businessName: "Beta Gym",
  tagline: "Stronger together.",
  headings: ["Train with purpose", "Join today", "Our coaches"],
  paragraphs: ["We build fitness for real life."],
  buttons: ["Book a class", "Start free trial"],
  navLinks: [
    { label: "Classes", href: "/classes" },
    { label: "Coaches", href: "/coaches" },
  ],
  colors: [],
  fonts: [],
  fontSizes: [],
  images: [],
  layoutRules: [],
  faqs: [],
  testimonials: [],
  locations: [],
  team: [],
  offerings: [{ name: "Group class", description: "One hour", price: "$30" }],
  contact: { phone: "555-1234", email: "hi@example-gym.com", social: [] },
};

describe("generateWorkspaceMemory", () => {
  test("returns heuristic values without config", async () => {
    const memory = await generateWorkspaceMemory(baseScrape);
    expect(memory.industry).toContain("fitness");
    expect(memory.targetMember).toBeDefined();
    expect(memory.differentiators.length).toBeGreaterThan(0);
    expect(memory.targetMembers).toEqual([]);
    expect(memory.positioning).toBeUndefined();
  });

  test("does not generate a heuristic positioning from description", async () => {
    const memory = await generateWorkspaceMemory(baseScrape);
    expect(memory.positioning).toBeUndefined();
  });

  test("does not auto-populate currentGoal", async () => {
    const memory = await generateWorkspaceMemory(baseScrape);
    expect(memory.currentGoal).toBeUndefined();
  });

  test("detects CrossFit niche", async () => {
    const data: ScrapedWebsiteData = {
      ...baseScrape,
      headings: ["CrossFit for everyone"],
      offerings: [{ name: "CrossFit class", description: "One hour", price: "$30" }],
    };
    const memory = await generateWorkspaceMemory(data);
    expect(memory.industry).toBe("fitness / gym: CrossFit");
  });

  test("detects BJJ niche", async () => {
    const data: ScrapedWebsiteData = {
      ...baseScrape,
      paragraphs: ["We teach Brazilian jiu-jitsu for self defense and competition."],
      offerings: [{ name: "BJJ fundamentals", description: "Beginner class", price: "$40" }],
    };
    const memory = await generateWorkspaceMemory(data);
    expect(memory.industry).toBe("fitness / gym: BJJ");
  });

  test("does not use tagline as target member", async () => {
    const data: ScrapedWebsiteData = {
      ...baseScrape,
      tagline: "Every body is unique. find something that works for you, crosstrain classes",
      headings: ["Every body is unique"],
    };
    const memory = await generateWorkspaceMemory(data);
    expect(memory.targetMember).not.toContain("Every body is unique");
  });

  test("renders positioning when present", () => {
    const memory: import("@ploy-gyms/shared-types").WorkspaceMemory = {
      businessSnapshot: "Beta Gym — fitness / gym",
      positioning: "Personal training for busy parents who need efficient, coached workouts.",
      industry: "fitness / gym",
      targetMember: "1 ICP: Busy parents",
      targetMembers: [],
      antiTargetMembers: [],
      differentiators: ["Coach-led environment"],
      brandVoice: "Direct and inclusive",
      businessPriorities: ["Drive membership inquiries"],
      keyConstraints: [],
      currentGoal: "Drive membership inquiries",
      lockedDecisions: [],
      knownBlockers: [],
      followUpBacklog: [],
      referenceDocKeys: ["brand-guidelines"],
    };
    const rendered = renderWorkspaceMemory(memory);
    expect(rendered).toContain("### Positioning");
    expect(rendered).toContain("Personal training for busy parents");
  });

  test("renders ICP(s) heading and profiles when present", () => {
    const memory: import("@ploy-gyms/shared-types").WorkspaceMemory = {
      businessSnapshot: "Beta Gym — fitness / gym: CrossFit",
      industry: "fitness / gym: CrossFit",
      targetMember: "2 ICPs: Busy parents, Former athletes",
      targetMembers: [
        {
          name: "Busy parents",
          summary: "Parents fitting fitness into a packed schedule.",
          demographics: "Ages 30-45, early mornings or lunch hours",
          psychographics: "Wants efficiency and community accountability",
          jobsToBeDone: ["Stay active without spending hours at the gym"],
          commonObjections: ["I don't have time"],
          entrySignals: ["mentions 'busy schedule'", "asks about class times"],
        },
      ],
      antiTargetMembers: [
        {
          name: "Discount hopper",
          summary: "Negotiates on price and churns within 60 days.",
        },
      ],
      differentiators: ["Coach-led classes every session"],
      brandVoice: "Direct and inclusive",
      businessPriorities: ["Drive membership inquiries"],
      keyConstraints: [],
      currentGoal: "Drive membership inquiries",
      lockedDecisions: [],
      knownBlockers: [],
      followUpBacklog: [],
      referenceDocKeys: ["brand-guidelines"],
    };
    const rendered = renderWorkspaceMemory(memory);
    expect(rendered).toContain("### ICP(s)");
    expect(rendered).toContain("#### Ideal customer profiles");
    expect(rendered).toContain("Busy parents");
    expect(rendered).toContain("*Hires the gym for:*");
    expect(rendered).toContain("#### Not a fit");
    expect(rendered).toContain("Discount hopper");
  });

  test("does not render elevator pitch or brand positioning sections", () => {
    const memory: import("@ploy-gyms/shared-types").WorkspaceMemory = {
      businessSnapshot: "Beta Gym — fitness / gym",
      industry: "fitness / gym",
      targetMember: "People interested in group class",
      targetMembers: [],
      antiTargetMembers: [],
      differentiators: ["Coach-led environment"],
      brandVoice: "Direct and inclusive",
      businessPriorities: ["Drive membership inquiries"],
      keyConstraints: [],
      currentGoal: "Drive membership inquiries",
      lockedDecisions: [],
      knownBlockers: [],
      followUpBacklog: [],
      referenceDocKeys: ["brand-guidelines"],
    };
    const rendered = renderWorkspaceMemory(memory);
    expect(rendered).not.toContain("### Elevator pitch");
    expect(rendered).not.toContain("## Brand positioning");
  });
});
