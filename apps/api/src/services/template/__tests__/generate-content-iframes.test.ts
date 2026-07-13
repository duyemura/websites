// @vitest-environment node
import { describe, test, expect } from "vitest";
import {
  normalizePath,
  matchExtractPath,
  mergeExtractIframesIntoPages,
} from "../generate-content";
import type { GymSiteContent } from "@milo/shared-types";

describe("normalizePath", () => {
  test.each([
    ["/", "/"],
    ["/schedule", "/schedule"],
    ["/schedule/", "/schedule"],
    ["/about-us/", "/about-us"],
  ])("normalizePath(%s) = %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe("matchExtractPath", () => {
  test.each([
    ["/", "home"],
    ["/about", "about"],
    ["/about-us", "about"],
    ["/contact", "contact"],
    ["/pricing", "pricing"],
    ["/membership", "pricing"],
    ["/join", "pricing"],
    ["/schedule", "schedule"],
    ["/classes", "schedule"],
    ["/book", "schedule"],
    ["/programs/crossfit", null],
  ])("matchExtractPath(%s) = %s", (input, expected) => {
    expect(matchExtractPath(input)).toBe(expected);
  });
});

describe("mergeExtractIframesIntoPages", () => {
  function makePages(): GymSiteContent["pages"] {
    return {
      home: { hero: { headline: "" }, valueProps: [], programsHeadline: "", featuredPrograms: [], features: [], communityHeadline: "", communityProps: [], trustHeadline: "", howItWorks: [], howItWorksHeadline: "", testimonials: [], faq: [] },
      programs: [
        { slug: "crossfit", name: "CrossFit", shortDescription: "", coverImageUrl: "", hero: { headline: "" }, whatIsIt: { headline: "", body: "" }, whatMakesUsDifferent: [], whatToExpect: { headline: "", steps: [] }, whoIsItFor: [], gettingStarted: [], testimonials: [], faq: [] },
      ],
      about: { hero: { headline: "" }, gymStory: "", team: [] },
      pricing: { hero: { headline: "" } },
      contact: { hero: { headline: "" } },
      schedule: { hero: { headline: "" } },
      blog: { heroHeadline: "", posts: [] },
      localGuide: { hero: { headline: "" }, sections: [] },
      legal: [],
    };
  }

  test("places home iframes on home, schedule iframes on schedule, etc.", () => {
    const pages = makePages();
    const extractIframes = new Map([
      ["/", [{ src: "https://widgets.trustpilot.com/reviews/123", variant: "default" }]],
      ["/schedule", [{ src: "https://app.acuityscheduling.com/schedule.php", variant: "schedule" }]],
      ["/contact", [{ src: "https://www.google.com/maps/embed?pb=abc", variant: "map" }]],
    ]);

    mergeExtractIframesIntoPages(pages, extractIframes);

    expect(pages.home.iframes).toHaveLength(1);
    expect(pages.home.iframes?.[0].src).toBe("https://widgets.trustpilot.com/reviews/123");
    expect(pages.schedule.iframes).toHaveLength(1);
    expect(pages.contact.iframes).toHaveLength(1);
  });

  test("dedupes against iframes already placed by content-mapper", () => {
    const pages = makePages();
    pages.home.iframes = [{ src: "https://widgets.trustpilot.com/reviews/123", variant: "default" }];
    const extractIframes = new Map([["/", [{ src: "https://widgets.trustpilot.com/reviews/123", variant: "default" }]]]);

    mergeExtractIframesIntoPages(pages, extractIframes);

    expect(pages.home.iframes).toHaveLength(1);
  });

  test("does not dedupe the same src across different generated pages", () => {
    const pages = makePages();
    const extractIframes = new Map([
      ["/", [{ src: "https://widgets.trustpilot.com/reviews/123", variant: "default" }]],
      ["/about", [{ src: "https://widgets.trustpilot.com/reviews/123", variant: "default" }]],
    ]);

    mergeExtractIframesIntoPages(pages, extractIframes);

    expect(pages.home.iframes).toHaveLength(1);
    expect(pages.about.iframes).toHaveLength(1);
  });
});
