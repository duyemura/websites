import { describe, it, expect } from "vitest";
import { loadPage, gym, builtCss, jsonLd, readDist } from "./helpers";

describe("layout skeleton", () => {
  it("homepage renders with gym name in title and exact hero headline", () => {
    const $ = loadPage("index.html");
    expect($("title").text()).toContain(gym.business.name);
    // Target by data-testid so future header/nav h1s don't silently pass this assertion
    expect($("[data-testid='hero-headline']").text().trim()).toBe(gym.pages.home.hero.headline);
  });

  it("brand tokens are emitted as CSS custom properties", () => {
    const $ = loadPage("index.html");
    const css = $("style").text();
    expect(css).toContain(`--color-primary: ${gym.brand.primaryColor}`);
    expect(css).toContain(`--font-heading:`);
  });

  it("sr-only class is present in built CSS (AEO entity anchor must be off-screen, not missing)", () => {
    // If Tailwind drops sr-only from the bundle, the AEO paragraph becomes visible body text
    expect(builtCss()).toMatch(/\.sr-only\s*\{/);
  });
});

describe("SEO layer", () => {
  it("homepage has canonical URL, robots index, and verification tag", () => {
    const $ = loadPage("index.html");
    expect($('link[rel="canonical"]').attr("href")).toBe(`${gym.meta.siteUrl}/`);
    expect($('meta[name="robots"]').attr("content")).toBe("index,follow");
    expect($('meta[name="google-site-verification"]').attr("content")).toBe(gym.meta.googleSiteVerification);
  });

  it("homepage has Open Graph + Twitter card tags", () => {
    const $ = loadPage("index.html");
    expect($('meta[property="og:title"]').attr("content")).toBeTruthy();
    expect($('meta[property="og:url"]').attr("content")).toBe(`${gym.meta.siteUrl}/`);
    expect($('meta[name="twitter:card"]').attr("content")).toBe("summary_large_image");
  });

  it("every page carries LocalBusiness+SportsActivityLocation with NAP, geo, hours, rating, sameAs", () => {
    const $ = loadPage("index.html");
    const lb = jsonLd($).find((s) => Array.isArray(s["@type"]) && (s["@type"] as string[]).includes("LocalBusiness"));
    expect(lb).toBeTruthy();
    expect(lb!["name"]).toBe(gym.business.name);
    expect(lb!["telephone"]).toBe(gym.business.phone);
    expect((lb!["geo"] as any).latitude).toBe(gym.business.coordinates.lat);
    expect((lb!["aggregateRating"] as any).reviewCount).toBe(String(gym.business.aggregateRating.reviewCount));
    expect(lb!["sameAs"]).toContain(gym.business.social.facebook);
    expect((lb!["areaServed"] as string[])).toContain("Leawood");
    expect(lb!["description"]).toBe(gym.business.tagline);
  });
});

describe("tracking layer", () => {
  it("injects GTM when googleTagManagerId is set (fixture has one)", () => {
    const html = readDist("index.html");
    expect(html).toContain(`googletagmanager.com/gtm.js`);
    expect(html).toContain(gym.meta.googleTagManagerId);
  });

  it("loads UTM tracker and events scripts on every page", () => {
    const $ = loadPage("index.html");
    expect($('script[src="/scripts/utm-tracker.js"]').length).toBe(1);
    expect($('script[src="/scripts/tracking-events.js"]').length).toBe(1);
  });
});
