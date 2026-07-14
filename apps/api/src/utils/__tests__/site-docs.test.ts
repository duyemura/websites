import { describe, test, expect } from "vitest";
import { generateSiteDocs } from "../site-docs.js";
import type { ScrapedWebsiteData } from "../scrape-docs.js";

describe("site strategy doc", () => {
  const scraped: ScrapedWebsiteData = {
    url: "https://ksathleticclub.com",
    title: "KSA Athletic Club",
    businessName: "KSA Athletic Club",
    tagline: "Train harder. Live better.",
    headings: ["CrossFit in Torrance"],
    paragraphs: ["Premier CrossFit gym in Torrance, CA."],
    buttons: ["Start free trial"],
    navLinks: [{ label: "About", href: "/about" }],
    colors: [],
    fonts: [],
    fontSizes: [],
    images: [],
    layoutRules: [],
    faqs: [],
    testimonials: [],
    locations: [],
    team: [],
    offerings: [],
    contact: {},
  };

  test("site-strategy doc includes a site playbook section", async () => {
    const docs = await generateSiteDocs(scraped);
    const strategy = docs.find((d) => d.key === "site-strategy");
    expect(strategy).toBeDefined();
    expect(strategy?.content).toContain("## Site playbook");
    expect(strategy?.content).toContain("### Conversion goal");
    expect(strategy?.content).toContain("### Ideal first action");
    expect(strategy?.content).toContain("### Voice rules");
  });

  test("playbook surfaces conversion signals when business-info extraction is missing", async () => {
    const docs = await generateSiteDocs(scraped);
    const strategy = docs.find((d) => d.key === "site-strategy")!;
    expect(strategy.content).toContain("Book a free intro or tour");
    expect(strategy.content).toContain("Free intro or trial class");
  });

  test("site-strategy references the gym name and source facts", async () => {
    const docs = await generateSiteDocs(scraped);
    const strategy = docs.find((d) => d.key === "site-strategy")!;
    expect(strategy.content).toContain("KSA Athletic Club");
    expect(strategy.content).toContain("Source website:");
    expect(strategy.content).toContain("https://ksathleticclub.com");
  });
});
