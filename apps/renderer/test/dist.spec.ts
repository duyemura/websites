import { describe, it, expect } from "vitest";
import { loadPage, gym, builtCss, jsonLd, readDist, distExists } from "./helpers";

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
    expect($('meta[name="twitter:card"]').attr("content")).toBe("summary");
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
    expect((lb!["areaServed"] as string[])).toContain(gym.business.serviceArea[0]);
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

describe("chrome", () => {
  it("header renders all top-level nav items and the announcement bar", () => {
    const $ = loadPage("index.html");
    const navText = $("header").text();
    for (const item of gym.navigation.header) expect(navText).toContain(item.label);
    expect($("header").text()).toContain(gym.navigation.announcement.text);
  });

  it("footer renders link groups, NAP, and social links", () => {
    const $ = loadPage("index.html");
    const footer = $("footer");
    for (const group of gym.navigation.footer) expect(footer.text()).toContain(group.label);
    expect(footer.text()).toContain(gym.business.address.street);
    expect(footer.text()).toContain(gym.business.phone);
    expect(footer.find(`a[href="${gym.business.social.instagram}"]`).length).toBe(1);
  });

  it("sticky CTA is present with the primary CTA label", () => {
    const $ = loadPage("index.html");
    expect($("#sticky-cta").text()).toContain(gym.business.primaryCta.label);
  });
});

describe("homepage", () => {
  it("renders all six FeatureGrid items and four community props", () => {
    const $ = loadPage("index.html");
    for (const f of gym.pages.home.features) expect($("body").text()).toContain(f.label);
    for (const p of gym.pages.home.communityProps) expect($("body").text()).toContain(p.headline);
  });

  it("renders program cards for each featured program with links", () => {
    const $ = loadPage("index.html");
    for (const slug of gym.pages.home.featuredPrograms) {
      expect($(`a[href="/programs/${slug}"]`).length).toBeGreaterThan(0);
    }
  });

  it("renders FAQ as accessible details/summary and emits FAQPage schema", () => {
    const $ = loadPage("index.html");
    expect($("details.faq-item").length).toBe(gym.pages.home.faq.length);
    const faq = jsonLd($).find((s) => s["@type"] === "FAQPage") as any;
    expect(faq).toBeTruthy();
    expect(faq.mainEntity.length).toBe(gym.pages.home.faq.length);
    expect(faq.mainEntity[0].name).toBe(gym.pages.home.faq[0].question);
  });

  it("renders the location section with address, directions link, and map embed", () => {
    const $ = loadPage("index.html");
    expect($("body").text()).toContain(gym.business.address.street);
    expect($('a[href^="https://www.google.com/maps"]').length).toBeGreaterThan(0);
    expect($(`iframe[src="${gym.business.mapEmbedUrl}"]`).length).toBe(1);
  });
});

describe("program pages", () => {
  it("builds one page per program with geo headline, geo title, and exactly one h1", () => {
    for (const p of gym.pages.programs) {
      const $ = loadPage(`programs/${p.slug}/index.html`);
      expect($("h1").first().text()).toContain(`${p.name} in ${gym.business.geo.city}, ${gym.business.geo.stateAbbr}`);
      expect($("title").text()).toContain(gym.business.geo.city);
      // Guard: Hero must render as h2 (h1={false}) — two h1s would hurt SEO silently
      expect($("h1").length).toBe(1);
    }
  });

  it("emits Service + BreadcrumbList schema on program pages", () => {
    const firstProgram = gym.pages.programs[0];
    const $ = loadPage(`programs/${firstProgram.slug}/index.html`);
    const schemas = jsonLd($);
    const service = schemas.find((s) => s["@type"] === "Service") as any;
    expect(service.name).toBe(firstProgram.name);
    expect(service.areaServed.map((a: any) => a.name)).toContain(gym.business.serviceArea[0]);
    const crumbs = schemas.find((s) => s["@type"] === "BreadcrumbList") as any;
    expect(crumbs.itemListElement[2].name).toBe(firstProgram.name);
  });

  it("renders differentiators, class structure, and program FAQ with schema", () => {
    const prog = gym.pages.programs[0];
    const $ = loadPage(`programs/${prog.slug}/index.html`);
    for (const d of prog.whatMakesUsDifferent) expect($("body").text()).toContain(d);
    for (const s of prog.whatToExpect.steps) expect($("body").text()).toContain(s);
    expect(jsonLd($).some((s) => s["@type"] === "FAQPage")).toBe(true);
  });
});

describe("about / contact / schedule", () => {
  it("about renders every team member", () => {
    const $ = loadPage("about/index.html");
    for (const m of gym.pages.about.team) {
      expect($("body").text()).toContain(m.name);
      expect($("body").text()).toContain(m.title);
    }
  });

  it("contact has a lead form posting to the API forms endpoint with honeypot", () => {
    const $ = loadPage("contact/index.html");
    const form = $("form[data-lead-form]");
    expect(form.attr("action")).toBe(`${gym.meta.apiBaseUrl}/api/forms/${gym.meta.siteId}/contact`);
    expect(form.attr("method")).toBe("post");
    expect(form.find('input[name="_hp"]').length).toBe(1);
    expect(form.find('input[name="email"]').length).toBe(1);
  });

  it("schedule embeds the booking widget html", () => {
    const $ = loadPage("schedule/index.html");
    expect($("#fixture-booking-widget").length).toBe(1);
  });
});

describe("pricing", () => {
  it("renders all plans with the highlighted plan badged", () => {
    const $ = loadPage("pricing/index.html");
    for (const plan of gym.pages.pricing.grid.plans) {
      expect($("body").text()).toContain(plan.name);
      expect($("body").text()).toContain(plan.price);
    }
    expect($("body").text()).toContain("Most Popular");
  });

  it("renders the rate-sheet request form posting to formId 'pricing'", () => {
    const $ = loadPage("pricing/index.html");
    expect($("form[data-lead-form]").attr("action")).toContain("/forms/");
    expect($("form[data-lead-form]").attr("action")).toMatch(/\/pricing$/);
  });
});

describe("blog + wells + utility pages", () => {
  it("blog index lists every post with category labels", () => {
    const $ = loadPage("blog/index.html");
    for (const post of gym.pages.blog.posts) {
      expect($("body").text()).toContain(post.title);
      expect($(`a[href="/blog/${post.slug}"]`).length).toBeGreaterThan(0);
    }
    expect($("body").text()).toContain("Education");
  });

  it("blog post renders markdown body and BlogPosting schema", () => {
    const post = gym.pages.blog.posts[0];
    const $ = loadPage(`blog/${post.slug}/index.html`);
    expect($("body").text()).toContain("Why now?");
    expect($("article img").length).toBeGreaterThan(0);
    const schema = jsonLd($).find((s) => s["@type"] === "BlogPosting") as any;
    expect(schema.headline).toBe(post.title);
    expect(schema.datePublished).toBe(post.publishedAt);
  });

  it("local guide renders rich content sections", () => {
    const $ = loadPage("local-guide/index.html");
    for (const s of gym.pages.localGuide.sections) expect($("body").text()).toContain(s.headline);
  });

  it("legal pages and 404 exist", () => {
    expect(distExists("legal/privacy-policy/index.html")).toBe(true);
    expect(distExists("legal/terms-of-use/index.html")).toBe(true);
    expect(distExists("404.html")).toBe(true);
  });

  it("rss.xml lists blog posts", () => {
    const xml = readDist("rss.xml");
    expect(xml).toContain("<rss");
    expect(xml).toContain(gym.pages.blog.posts[0].title);
  });
});

describe("discovery files", () => {
  it("sitemap lists all public routes and not legal/404", () => {
    const xml = readDist("sitemap.xml");
    for (const p of ["/", "/about", "/pricing", "/contact", "/schedule", "/blog", "/local-guide"]) {
      expect(xml).toContain(`<loc>${gym.meta.siteUrl}${p}</loc>`);
    }
    expect(xml).toContain(`/programs/${gym.pages.programs[0].slug}`);
    expect(xml).toContain(`/blog/${gym.pages.blog.posts[0].slug}`);
    expect(xml).not.toContain("/legal/");
  });

  it("robots.txt allows crawling and points at sitemap", () => {
    const txt = readDist("robots.txt");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain(`Sitemap: ${gym.meta.siteUrl}/sitemap.xml`);
  });

  it("llms.txt describes the business, programs, location", () => {
    const txt = readDist("llms.txt");
    expect(txt).toContain(gym.business.name);
    expect(txt).toContain(gym.business.geo.city);
    for (const p of gym.pages.programs) expect(txt).toContain(p.name);
  });
});
