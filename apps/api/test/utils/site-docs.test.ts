import { describe, test, expect } from "vitest";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import { generateBrandGuidelines, BRAND_GUIDELINES_DOC_KEY } from "../../src/utils/brand-guidelines";
import { buildBrandGuidelinesInput, type ScrapedWebsiteData } from "../../src/utils/scrape-docs";
import { generateSiteDocs, generateSiteDocsFromTemplate, generateSiteDocsForGreenfield } from "../../src/utils/site-docs";
import type { SiteHierarchy } from "../../src/types/site-hierarchy";
import type { DesignSystemV2 } from "../../src/types/design-system-v2";
import type { SectionVisualEvidence } from "../../src/types/section-visual-evidence";
import type { TemplateShell } from "@ploy-gyms/shared-types";

async function docKeys(docs: Promise<ReturnType<typeof generateSiteDocs>>): Promise<string[]> {
  return (await docs).map((d) => d.key);
}

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
    { token: "bg", hex: "#FFFFFF", role: "background", usage: "background" },
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
  contact: {
    phone: "555-1234",
    email: "hi@example-gym.com",
    social: [
      { platform: "Instagram", url: "https://instagram.com/betagym" },
      { platform: "Facebook", url: "https://facebook.com/betagym" },
      { platform: "YouTube", url: "https://youtube.com/@betagym" },
    ],
  },
  screenshotUrls: ["https://example-gym.com/screenshot.png"],
  sections: [
    {
      id: "section-hero",
      type: "Hero",
      heading: "Train with purpose",
      body: "We build fitness for real life.",
      cta: { label: "Book a class", href: "#cta" },
      visualEvidence: {
        evidenceId: "ev-hero",
        pageSlug: "index",
        sectionId: "section-hero",
        boundingBox: { x: 0, y: 0, width: 1200, height: 600 },
        computedStyles: [],
      },
    },
    {
      id: "section-features",
      type: "SiteCardGroup",
      heading: "What we offer",
      items: [{ title: "Group class", description: "One hour" }],
      visualEvidence: {
        evidenceId: "ev-features",
        pageSlug: "index",
        sectionId: "section-features",
        boundingBox: { x: 0, y: 600, width: 1200, height: 400 },
        computedStyles: [],
      },
    },
  ],
};

const baseGmb: GmbListing = {
  placeId: "places/abc123",
  name: "Beta Gym GMB",
  primaryType: "fitness_center",
  types: ["fitness_center", "gym", "health_club"],
  address: {
    streetNumber: "123",
    streetName: "Main St",
    city: "Anytown",
    state: "CA",
    country: "US",
    postalCode: "90210",
  },
  phoneNumber: "555-9999",
  websiteUri: "https://gmb-website.example.com",
  googleMapsUri: "https://maps.google.com/?cid=abc123",
  rating: 4.8,
  userRatingCount: 120,
  editorialSummary: "Top-rated functional fitness gym.",
  regularOpeningHours: [
    { day: "MONDAY", open: "5:00 AM", close: "10:00 PM" },
    { day: "TUESDAY", open: "5:00 AM", close: "10:00 PM" },
  ],
  photos: [{ name: "photo1", url: "https://example.com/photo1.jpg" }],
  reviews: [{ name: "review1", rating: 5, text: "Great gym", author: "Sam" }],
  businessStatus: "OPERATIONAL",
};

describe("generateBrandGuidelines", () => {
  test("renders brand guidelines markdown from scraped input", () => {
    const input = buildBrandGuidelinesInput({ scraped: baseScrape });
    const markdown = generateBrandGuidelines(input);
    expect(markdown).toContain("# Beta Gym Brand Guidelines");
    expect(markdown).toContain("**Industry**: fitness / gym");
    expect(markdown).toContain("### Captured palette");
    expect(markdown).toContain("### Strategy");
    expect(markdown).toMatch(/\*\*Background\*\* — `bg` <span[^>]*background-color:#FFFFFF[^>]*><\/span>#FFFFFF/);
    expect(markdown).toMatch(/\*\*Primary text\*\* — `primary` <span[^>]*background-color:#111111[^>]*><\/span>#111111 — headings/);
    expect(markdown).toMatch(/\*\*Accent\*\* — `accent` <span[^>]*background-color:#ff4d00[^>]*><\/span>#ff4d00 — CTAs/);
    expect(markdown).toMatch(/background-color:#111111/);
    expect(markdown).toMatch(/background-color:#ff4d00/);
    expect(markdown).toMatch(/background-color:#FFFFFF/);
    expect(markdown).not.toContain("| Role | Token | Hex | Usage |");
    expect(markdown).toContain("**Tagline**: Stronger together.");
    expect(markdown).toContain("![Asset ID: Original Website Screenshot](https://example-gym.com/screenshot.png)");
    expect(markdown).toContain("**Color Strategy**");
    expect(markdown).toContain("**Pairing Rule**");
    expect(markdown).toContain("**Dark Mode Behavior**");
    expect(markdown).toContain("**Imagery Style**");
    expect(markdown).toContain("**Detected components**");
  });
});

describe("generateSiteDocs", () => {
  test("generates core docs from scraped data", async () => {
    const keys = await docKeys(generateSiteDocs(baseScrape));
    expect(keys).toEqual([
      "workspace-memory",
      "site-memory",
      BRAND_GUIDELINES_DOC_KEY,
      "business-info",
      "site-strategy",
      "blueprint-draft",
      "design-system",
      "site-hierarchy",
      "section-visual-evidence",
    ]);
  });

  test("does not generate removed standalone docs", async () => {
    const keys = await docKeys(generateSiteDocs(baseScrape));
    expect(keys).not.toContain("site-structure");
    expect(keys).not.toContain("team-bios");
    expect(keys).not.toContain("testimonials");
    expect(keys).not.toContain("faqs");
  });

  test("workspace memory includes business snapshot and reference docs", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const memory = docs.find((d) => d.key === "workspace-memory")!;
    expect(memory.content).toContain("Beta Gym");
    expect(memory.content).toContain("Business priorities");
    expect(memory.content).toContain("[[brand-guidelines]]");
    expect(memory.content).toContain("[[business-info]]");
    expect(memory.content).toContain("[[site-strategy]]");
    expect(memory.content).not.toContain("[[site-structure]]");
  });

  test("workspace memory includes niche industry and ICP summary", async () => {
    const crossfitScrape = {
      ...baseScrape,
      headings: ["CrossFit for everyone", "Our coaches", "Join the community"],
      offerings: [{ name: "CrossFit class", description: "One hour", price: "$30" }],
    };
    const docs = await generateSiteDocs(crossfitScrape);
    const memory = docs.find((d) => d.key === "workspace-memory")!;
    expect(memory.content).toContain("fitness / gym: CrossFit");
    expect(memory.content).toContain("ICP(s)");
  });

  test("workspace memory does not render elevator pitch or brand positioning sections", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const memory = docs.find((d) => d.key === "workspace-memory")!;
    expect(memory.content).not.toContain("## Elevator pitch");
    expect(memory.content).not.toContain("### Elevator pitch");
    expect(memory.content).not.toContain("## Brand positioning");
  });

  test("site memory includes source url and publish state", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const memory = docs.find((d) => d.key === "site-memory")!;
    expect(memory.content).toContain(baseScrape.url);
    expect(memory.content).toContain("Publish state");
    expect(memory.content).toContain("draft");
  });

  test("business info doc includes contact, social links, offerings, locations, team, testimonials, and faqs", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const businessInfo = docs.find((d) => d.key === "business-info")!;
    expect(businessInfo.content).toContain("Beta Gym");
    expect(businessInfo.content).toContain("Stronger together.");
    expect(businessInfo.content).toContain("## Contact");
    expect(businessInfo.content).toContain("555-1234");
    expect(businessInfo.content).toContain("hi@example-gym.com");
    expect(businessInfo.content).toContain("## External profiles");
    expect(businessInfo.content).toContain("Instagram: https://instagram.com/betagym");
    expect(businessInfo.content).toContain("Facebook: https://facebook.com/betagym");
    expect(businessInfo.content).toContain("YouTube: https://youtube.com/@betagym");
    expect(businessInfo.content).toContain("Group class");
    expect(businessInfo.content).toContain("Downtown");
    expect(businessInfo.content).toContain("123 Main St");
    expect(businessInfo.content).toContain("Coach Alex");
    expect(businessInfo.content).toContain("Best gym in town.");
    expect(businessInfo.content).toContain("Do you offer drop-ins?");
  });

  test("business info doc emits phone and email only under the Contact section", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const businessInfo = docs.find((d) => d.key === "business-info")!;
    const [, afterContact] = businessInfo.content.split("## Contact");
    expect(afterContact).toContain("**Phone**: 555-1234");
    expect(afterContact).toContain("**Email**: hi@example-gym.com");
    expect(businessInfo.content.match(/\*\*Phone\*\*:/g)).toHaveLength(1);
    expect(businessInfo.content.match(/\*\*Email\*\*:/g)).toHaveLength(1);
  });

  test("business info doc includes gmb-only fields when provided", async () => {
    const docs = await generateSiteDocs(baseScrape, baseGmb);
    const businessInfo = docs.find((d) => d.key === "business-info")!;
    expect(businessInfo.content).toContain("# Beta Gym GMB");
    expect(businessInfo.content).toContain("**Tagline**: Top-rated functional fitness gym.");
    expect(businessInfo.content).toContain("## External profiles");
    expect(businessInfo.content).toContain("Google Maps: https://maps.google.com/?cid=abc123");
    expect(businessInfo.content).toContain("Website: https://gmb-website.example.com");
    expect(businessInfo.content).toContain("## Google Business Profile");
    expect(businessInfo.content).toContain("**Rating**: 4.8 / 5 (120 reviews)");
    expect(businessInfo.content).toContain("**Primary category**: fitness_center");
    expect(businessInfo.content).toContain("## Location");
    expect(businessInfo.content).toContain("123 Main St, Anytown, CA, 90210");
    expect(businessInfo.content).toContain("Monday: 5:00 AM–10:00 PM");
    expect(businessInfo.content).toContain("## Contact");
    expect(businessInfo.content).toContain("**Phone**: 555-9999");
  });

  test("business info doc falls back to gmb reviews when scraped testimonials are missing", async () => {
    const docs = await generateSiteDocs({ ...baseScrape, testimonials: [] }, baseGmb);
    const businessInfo = docs.find((d) => d.key === "business-info")!;
    expect(businessInfo.content).toContain("## Testimonials");
    expect(businessInfo.content).toContain('"Great gym" — Sam');
  });

  test("site strategy includes gmb source facts", async () => {
    const docs = await generateSiteDocs(baseScrape, baseGmb);
    const plan = docs.find((d) => d.key === "site-strategy")!;
    expect(plan.content).toContain("Google Business Profile verified as Beta Gym GMB.");
    expect(plan.content).toContain("Primary category: fitness_center.");
    expect(plan.content).toContain("Rating: 4.8 / 5.");
    expect(plan.content).toContain("1 GMB photos available for asset curation.");
  });

  test("site strategy includes site structure, phases, decisions, and next action", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const plan = docs.find((d) => d.key === "site-strategy")!;
    expect(plan.content).toContain("https://example-gym.com");
    expect(plan.content).toContain("## Site structure");
    expect(plan.content).toContain("[Classes](/classes)");
    expect(plan.content).toContain("## Build phases");
    expect(plan.content).toContain("## Build plan");
    expect(plan.content).toContain("## Next action");
    expect(plan.content).not.toContain("Train with purpose");
  });

  test("brand guidelines include voice and copy examples", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const brand = docs.find((d) => d.key === BRAND_GUIDELINES_DOC_KEY)!;
    expect(brand.content).toContain("Tone keywords");
    expect(brand.content).toContain("Copy examples");
    expect(brand.content).toContain("Train with purpose");
    expect(brand.content).toContain("Book a class");
  });

  test("brand guidelines include substantive tone of voice guidance", async () => {
    const docs = await generateSiteDocs(baseScrape);
    const brand = docs.find((d) => d.key === BRAND_GUIDELINES_DOC_KEY)!;
    expect(brand.content).toContain("Voice attributes");
    expect(brand.content).toContain("Do");
    expect(brand.content).toContain("Avoid");
    expect(brand.content).toContain("direct");
    expect(brand.content).toContain("inclusive");
  });

  test("emits blueprint-draft doc with usable blueprint JSON", async () => {
    const docs = await generateSiteDocs(baseScrape, baseGmb);
    const blueprintDoc = docs.find((d) => d.key === "blueprint-draft")!;
    expect(blueprintDoc.content).toContain("## Site blueprint");

    const match = blueprintDoc.content.match(/```json\n([\s\S]*?)\n```/);
    expect(match).toBeTruthy();
    const blueprint = JSON.parse(match![1]);
    expect(blueprint.site_metadata.framework).toBe("astro");
    expect(Array.isArray(blueprint.pages)).toBe(true);
    expect(blueprint.pages.length).toBeGreaterThan(0);
    expect(blueprint.design_tokens.colors.primary).toBeDefined();
  });

  test("emits site-hierarchy, design-system, and section-visual-evidence docs", async () => {
    const docs = await generateSiteDocs(baseScrape, baseGmb);
    const keys = docs.map((d) => d.key);
    expect(keys).toContain("site-hierarchy");
    expect(keys).toContain("design-system");
    expect(keys).toContain("section-visual-evidence");
    expect(keys).toContain("blueprint-draft");

    const hierarchyDoc = docs.find((d) => d.key === "site-hierarchy")!;
    const hierarchy: SiteHierarchy = JSON.parse(hierarchyDoc.content.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(hierarchy.pages[0].slug).toBe("index");
    expect(hierarchy.pages[0].sections.length).toBeGreaterThan(0);
    expect(hierarchy.pages[0].sections[0].intent).toBeDefined();

    const evidenceDoc = docs.find((d) => d.key === "section-visual-evidence")!;
    const evidence: SectionVisualEvidence = JSON.parse(evidenceDoc.content.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(evidence.rows.length).toBeGreaterThan(0);
    expect(evidence.rows[0].boundingBox.width).toBeGreaterThan(0);
  });
});

const templateShellFixture: TemplateShell = {
  source: {
    type: "url",
    url: "https://template-source.example.com",
    scrapedAt: new Date().toISOString(),
  },
  theme: {
    colors: {
      primary: "#111111",
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
  page: {
    title: "Template homepage",
    slug: "index",
    isHomePage: true,
    metaTitle: "Template homepage meta",
    metaDescription: "Template homepage description",
    sections: [
      {
        id: "header-shell",
        type: "SiteHeader",
        props: {
          logo: { type: "text", value: "{{placeholder-001: business name}}" },
          navLinks: [
            { label: "Classes", href: "/classes" },
            { label: "Coaches", href: "/coaches" },
          ],
          ctaLabel: "Join now",
          ctaHref: "#cta",
        },
      },
      {
        id: "hero-shell",
        type: "Hero",
        props: {
          title: "{{placeholder-002: headline}}",
          subtitle: "{{placeholder-003: subheadline}}",
          cta: { label: "{{placeholder-004: CTA}}", href: "#cta" },
          backgroundImage: null,
          layout: "center",
        },
      },
      {
        id: "features-shell",
        type: "SiteCardGroup",
        props: {
          title: "{{placeholder-005: section title}}",
          layout: "grid",
          cards: [
            { title: "{{placeholder-006: card title}}", description: "{{placeholder-007: card description}}" },
          ],
        },
      },
      {
        id: "footer-shell",
        type: "SiteFooter",
        props: {
          businessName: "{{placeholder-008: business name}}",
          navLinks: [],
          socialLinks: [],
          copyright: "© 2026 {{placeholder-008: business name}}. All rights reserved.",
        },
      },
    ],
  },
  placeholders: [
    { key: "placeholder-001", label: "Logo / business name", sectionId: "header-shell", propPath: "logo.value" },
    { key: "placeholder-002", label: "Hero headline", sectionId: "hero-shell", propPath: "title" },
  ],
  instructions: "Use the template structure and replace every placeholder.",
};

describe("generateSiteDocsFromTemplate", () => {
  test("emits the six expected core docs", () => {
    const docs = generateSiteDocsFromTemplate(
      "Beta Template",
      { key: "gym-neutro", name: "Gym Neutro", instructions: null },
      templateShellFixture,
    );
    const keys = docs.map((d) => d.key);
    expect(keys).toEqual([
      "site-memory",
      "site-strategy",
      "business-info",
      "design-system",
      "site-hierarchy",
      "section-visual-evidence",
    ]);
  });

  test("parsed hierarchy has a homepage with sections in template order", () => {
    const docs = generateSiteDocsFromTemplate(
      "Beta Template",
      { key: "gym-neutro", name: "Gym Neutro", instructions: null },
      templateShellFixture,
    );
    const hierarchyDoc = docs.find((d) => d.key === "site-hierarchy")!;
    const hierarchy: SiteHierarchy = JSON.parse(hierarchyDoc.content.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(hierarchy.pages[0].slug).toBe("index");
    expect(hierarchy.pages[0].sections.length).toBe(templateShellFixture.page.sections.length - 2);

    const sectionTags = hierarchy.pages[0].sections.map((s) => s.tag);
    expect(sectionTags).not.toContain("header");
    expect(sectionTags).toContain("hero");
    expect(sectionTags).toContain("feature-grid");
    expect(sectionTags).not.toContain("footer");

    const designSystemDoc = docs.find((d) => d.key === "design-system")!;
    const designSystem: DesignSystemV2 = JSON.parse(designSystemDoc.content.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(designSystem.global.shell.header).toBeDefined();
    expect(designSystem.global.shell.footer).toBeDefined();

    const hero = hierarchy.pages[0].sections.find((s) => s.tag === "hero")!;
    expect(hero.evidenceId).toBe("template-index-hero-shell");
    expect(hero.content.heading).toMatch(/^\{\{placeholder-/);
  });
});

describe("generateSiteDocsForGreenfield", () => {
  test("emits the six expected core docs", () => {
    const docs = generateSiteDocsForGreenfield(
      { uuid: "site-uuid-1", name: "Greenfield Gym", workspaceUuid: "ws-uuid-1" },
      { primaryColor: "#ff4d00", fontHeading: "Montserrat", fontBody: "Inter" },
      { businessName: "Greenfield Gym", tagline: "Stronger every day.", description: "A fresh gym brand." },
    );
    const keys = docs.map((d) => d.key);
    expect(keys).toEqual([
      "site-memory",
      "site-strategy",
      "business-info",
      "design-system",
      "site-hierarchy",
      "section-visual-evidence",
    ]);
  });

  test("design system uses the provided primary color", () => {
    const docs = generateSiteDocsForGreenfield(
      { uuid: "site-uuid-2", name: "Greenfield Gym", workspaceUuid: "ws-uuid-2" },
      { primaryColor: "#ff4d00" },
      { businessName: "Greenfield Gym" },
    );
    const designSystemDoc = docs.find((d) => d.key === "design-system")!;
    const designSystem = JSON.parse(designSystemDoc.content.match(/```json\n([\s\S]*?)\n```/)![1]);
    expect(designSystem.global.tokens.colors.primary).toBe("#ff4d00");
  });
});
