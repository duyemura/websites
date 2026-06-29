import { describe, test, expect } from "vitest";
import { generateBrandGuidelines, BRAND_GUIDELINES_DOC_KEY } from "../../src/utils/brand-guidelines";
import { buildBrandGuidelinesInput, type ScrapedWebsiteData } from "../../src/utils/scrape-docs";
import { generateSiteDocs } from "../../src/utils/site-docs";

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
  colors: [
    { token: "primary", hex: "#111111", role: "text", usage: "headings" },
    { token: "accent", hex: "#ff4d00", role: "accent", usage: "CTAs" },
  ],
  fonts: [{ family: "Inter", role: "body", weights: [400, 700] }],
  fontSizes: [{ element: "h1", desktop: "48px", mobile: "32px" }],
  images: [{ url: "https://example-gym.com/hero.jpg", context: "hero", promptKeywords: ["athletes", "gym"], alt: "Athletes training" }],
  layoutRules: [{ element: "section", value: "max-width 1200px, padding 80px vertical" }],
  faqs: [{ question: "Do you offer drop-ins?", answer: "Yes, $25 per class." }],
  testimonials: [{ quote: "Best gym in town.", author: "Jane D.", role: "Member" }],
  locations: [{ name: "Downtown", address: "123 Main St" }],
  team: [{ name: "Coach Alex", role: "Head coach", bio: "CSCS certified." }],
  offerings: [{ name: "Group class", description: "One hour", price: "$30" }],
  contact: { phone: "555-1234", email: "hi@example-gym.com", social: [{ platform: "Instagram", url: "https://instagram.com/betagym" }] },
  screenshotUrls: ["https://example-gym.com/screenshot.png"],
};

describe("generateBrandGuidelines", () => {
  test("renders brand guidelines markdown from scraped input", () => {
    const input = buildBrandGuidelinesInput(baseScrape);
    const markdown = generateBrandGuidelines(input);
    expect(markdown).toContain("# Beta Gym Brand Guidelines");
    expect(markdown).toContain("**Industry**: fitness / gym");
    expect(markdown).toContain("| Primary text | `primary` | #111111 | headings |");
    expect(markdown).toContain("| Accent | `accent` | #ff4d00 | CTAs |");
    expect(markdown).toContain("**Tagline**: Stronger together.");
    expect(markdown).toContain("![Original website screenshot](https://example-gym.com/screenshot.png)");
  });
});

describe("generateSiteDocs", () => {
  test("generates required docs and optional docs from scraped data", () => {
    const docs = generateSiteDocs(baseScrape);
    const keys = docs.map((d) => d.key);
    expect(keys).toContain(BRAND_GUIDELINES_DOC_KEY);
    expect(keys).toContain("business-info");
    expect(keys).toContain("site-structure");
    expect(keys).toContain("voice-copy");
    expect(keys).toContain("offerings");
    expect(keys).toContain("locations");
    expect(keys).toContain("team-bios");
    expect(keys).toContain("testimonials");
    expect(keys).toContain("faqs");
  });

  test("skips empty optional doc types", () => {
    const minimal: ScrapedWebsiteData = {
      ...baseScrape,
      offerings: [],
      locations: [],
      team: [],
      testimonials: [],
      faqs: [],
    };
    const docs = generateSiteDocs(minimal);
    const keys = docs.map((d) => d.key);
    expect(keys).not.toContain("offerings");
    expect(keys).not.toContain("locations");
    expect(keys).not.toContain("team-bios");
    expect(keys).not.toContain("testimonials");
    expect(keys).not.toContain("faqs");
    expect(keys).toContain(BRAND_GUIDELINES_DOC_KEY);
  });

  test("business info doc includes contact and social links", () => {
    const docs = generateSiteDocs(baseScrape);
    const businessInfo = docs.find((d) => d.key === "business-info")!;
    expect(businessInfo.content).toContain("Beta Gym");
    expect(businessInfo.content).toContain("Stronger together.");
    expect(businessInfo.content).toContain("555-1234");
    expect(businessInfo.content).toContain("hi@example-gym.com");
    expect(businessInfo.content).toContain("Instagram");
  });

  test("site structure doc includes nav links and headings", () => {
    const docs = generateSiteDocs(baseScrape);
    const structure = docs.find((d) => d.key === "site-structure")!;
    expect(structure.content).toContain("https://example-gym.com");
    expect(structure.content).toContain("[Classes](/classes)");
    expect(structure.content).toContain("Train with purpose");
  });

  test("voice doc includes headlines and CTAs", () => {
    const docs = generateSiteDocs(baseScrape);
    const voice = docs.find((d) => d.key === "voice-copy")!;
    expect(voice.content).toContain("Train with purpose");
    expect(voice.content).toContain("Book a class");
  });
});
