// apps/api/test/services/template/rendered-audit.test.ts
import { describe, expect, it } from "vitest";
import type { GymSiteContent, BusinessInfo } from "@milo/shared-types";
import {
  auditPage,
  applySelfHeals,
  buildAllowedPaths,
} from "../../../src/services/template/rendered-audit";

function makeBusiness(overrides: Partial<BusinessInfo> = {}): BusinessInfo {
  return {
    name: "Torrance Training Lab",
    tagline: "Coach-led fitness in Torrance, CA.",
    address: { street: "24551 Hawthorne Blvd", city: "Torrance", state: "CA", zip: "90505" },
    phone: "(310) 373-1400",
    email: "info@torrancetraininglab.com",
    hours: [],
    primaryCta: { label: "Start training", url: "/contact" },
    trialCta: { label: "Try 7 days free", url: "/pricing" },
    geo: { city: "Torrance", state: "California", stateAbbr: "CA" },
    serviceArea: ["Redondo Beach", "Hermosa Beach", "Palos Verdes", "Lomita"],
    aggregateRating: { ratingValue: "4.9", reviewCount: 127 },
    social: { instagram: "https://instagram.com/torrancetraininglab" },
    ...overrides,
  };
}

function makeContent(overrides: Partial<GymSiteContent> = {}): GymSiteContent {
  const business = makeBusiness(overrides.business ?? {});
  return {
    meta: {
      siteId: "site-test",
      apiBaseUrl: "https://api.example.com",
      siteUrl: "https://torrancetraininglab.com",
      defaultTitle: `${business.name} | ${business.geo.city} Gym`,
      defaultDescription: business.tagline,
      templateTheme: "beanburito",
    },
    business,
    brand: {
      primaryColor: "#111111",
      secondaryColor: "#171717",
      accentColor: "#737373",
      headingFont: "Inter",
      bodyFont: "Inter",
      logoUrl: "__NO_IMAGE__",
      logoAlt: business.name,
    },
    navigation: {
      header: [
        { label: "Home", href: "/" },
        { label: "Programs", href: "/programs", children: [{ label: "CrossFit", href: "/programs/crossfit" }] },
        { label: "About", href: "/about" },
        { label: "Contact", href: "/contact" },
      ],
      footer: [
        { label: "Programs", links: [{ label: "CrossFit", href: "/programs/crossfit" }] },
        { label: "Company", links: [{ label: "About", href: "/about" }] },
      ],
    },
    pages: {
      home: {
        hero: { headline: business.name, ctaLabel: "Start training", ctaUrl: "/contact" },
        valueProps: [],
        programsHeadline: "Our Programs",
        featuredPrograms: ["crossfit"],
        features: [],
        communityHeadline: "",
        communityProps: [],
        trustHeadline: "",
        howItWorks: [],
        howItWorksHeadline: "",
        testimonials: [],
        faq: [],
      },
      programs: [
        {
          slug: "crossfit",
          name: "CrossFit",
          shortDescription: "Functional fitness in Torrance.",
          coverImageUrl: "__NO_IMAGE__",
          hero: { headline: "CrossFit in Torrance", ctaUrl: "/contact" },
          whatIsIt: { headline: "", body: "" },
          whatMakesUsDifferent: [],
          whatToExpect: { headline: "", steps: [] },
          whoIsItFor: [],
          gettingStarted: [],
          testimonials: [],
          faq: [],
        },
      ],
      about: { hero: { headline: `About ${business.name}` }, gymStory: "", team: [] },
      pricing: { hero: { headline: "Pricing" } },
      contact: { hero: { headline: "Contact" } },
      schedule: { hero: { headline: "Schedule" } },
      blog: { heroHeadline: "Blog", posts: [] },
      legal: [],
    },
    ...overrides,
  } as GymSiteContent;
}

function pageHtml(business: BusinessInfo, extra = ""): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    address: {
      "@type": "PostalAddress",
      streetAddress: business.address.street,
      addressLocality: business.address.city,
      addressRegion: business.address.state,
      postalCode: business.address.zip,
    },
    telephone: business.phone,
    email: business.email,
    url: "https://torrancetraininglab.com",
  };
  return `<!doctype html>
<html>
<head><script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body>
  <h1>${business.name}</h1>
  <p>${business.tagline}</p>
  <p>${business.address.street}, ${business.address.city}, ${business.address.state} ${business.address.zip}</p>
  <p>${business.phone}</p>
  <p>${business.email}</p>
  ${extra}
</body>
</html>`;
}

describe("rendered-audit", () => {
  it("passes for a valid page with real business info", () => {
    const content = makeContent();
    const html = pageHtml(content.business);
    const { failures } = auditPage("/", html, content.business, buildAllowedPaths(content));
    expect(failures).toEqual([]);
  });

  it("flags placeholder business name in rendered text", () => {
    const content = makeContent();
    const html = pageHtml(content.business, "<p>Welcome to Your Gym Name</p>");
    const { failures } = auditPage("/", html, content.business, buildAllowedPaths(content));
    const leak = failures.find((f) => f.check === "placeholder-leak");
    expect(leak).toBeDefined();
    expect(leak?.message).toContain("Your Gym Name");
  });

  it("flags missing real gym name", () => {
    const content = makeContent();
    content.business.name = "Your Gym Name";
    const html = pageHtml(content.business).replace(/Torrance Training Lab/g, "");
    const { failures } = auditPage("/", html, content.business, buildAllowedPaths(content));
    expect(failures.some((f) => f.check === "business-name-present")).toBe(true);
  });

  it("flags JSON-LD telephone mismatch", () => {
    const content = makeContent();
    const html = pageHtml(content.business).replace(
      `"telephone":"${content.business.phone}"`,
      `"telephone":"(000) 000-0000"`,
    );
    const { failures } = auditPage("/", html, content.business, buildAllowedPaths(content));
    expect(failures.some((f) => f.check === "jsonld-phone")).toBe(true);
  });

  it("flags invalid internal links as fixable", () => {
    const content = makeContent();
    const html = pageHtml(content.business, '<a href="/programs/old-slug">Old program</a>');
    const { failures } = auditPage("/", html, content.business, buildAllowedPaths(content), [
      "/programs/old-slug",
    ]);
    const linkFailure = failures.find((f) => f.check === "internal-link-valid");
    expect(linkFailure).toBeDefined();
    expect(linkFailure?.fixable).toBe(true);
  });

  it("does not flag the 'YS' placeholder inside real words like 'gyms' or 'workouts'", () => {
    const content = makeContent();
    const html = pageHtml(content.business, "<p>We welcome people from nearby gyms and workouts of all levels.</p>");
    const { failures } = auditPage("/", html, content.business, buildAllowedPaths(content));
    expect(failures.filter((f) => f.check === "placeholder-leak")).toEqual([]);
  });

  it("still flags a standalone 'YS' placeholder", () => {
    const content = makeContent();
    const html = pageHtml(content.business, "<p>Join us in Your City, YS.</p>");
    const { failures } = auditPage("/", html, content.business, buildAllowedPaths(content));
    expect(failures.some((f) => f.check === "placeholder-leak" && f.message.includes('"YS"'))).toBe(true);
  });

  it("self-heals stale nav and CTA links", () => {
    const content = makeContent();
    content.navigation.header.push({ label: "Old program", href: "/programs/old-slug" });
    content.pages.home.hero.ctaUrl = "/programs/missing-program";

    const { content: fixedContent, healed: didHeal, heals } = applySelfHeals(content, [
      { page: "/", check: "internal-link-valid", message: "stale", fixable: true },
    ]);

    expect(didHeal).toBe(true);
    expect(heals.length).toBeGreaterThan(0);
    expect(fixedContent.navigation.header.some((i) => i.href === "/programs/old-slug")).toBe(false);
    expect(fixedContent.pages.home.hero.ctaUrl).toBe("/contact");
  });

  it("self-heals placeholder serviceArea and social URLs", () => {
    const content = makeContent();
    content.business.serviceArea = ["Nearby City 1", "Torrance"];
    content.business.social = { facebook: "https://facebook.com/yourgym" };

    const { content: healed, healed: didHeal, heals } = applySelfHeals(content, []);

    expect(didHeal).toBe(true);
    expect(heals.some((h) => h.includes("serviceArea"))).toBe(true);
    expect(heals.some((h) => h.includes("facebook"))).toBe(true);
    expect(healed.business.serviceArea).toEqual(["Torrance"]);
    expect(healed.business.social?.facebook).toBeUndefined();
  });
});
