import { describe, expect, it } from "vitest";
import { fingerprintSections, resolveSharedComponents, textSimilarity } from "../shared-components";

const sec = (page: string, id: string, tag: string, text: string, media: string[] = []) => ({
  pageId: page, sectionId: id, tag, innerText: text, mediaUrls: media,
  aspectRatio: 4.8,
});

describe("textSimilarity", () => {
  it("returns 1 for identical text", () => {
    expect(textSimilarity("Visit us at 123 Main St", "Visit us at 123 Main St")).toBe(1);
  });
  it("is high for near-identical text", () => {
    expect(textSimilarity("Call (555) 555-5555 today", "Call (555) 555-5556 today")).toBeGreaterThan(0.8);
  });
  it("is low for different text", () => {
    expect(textSimilarity("Our yoga classes", "Contact us at 123 Main St")).toBeLessThan(0.5);
  });
});

describe("resolveSharedComponents", () => {
  it("promotes exact repeats as normalized, canonical = most frequent", () => {
    const sections = [
      sec("/", "a", "location-block", "123 Main St · (555) 555-5555"),
      sec("/about", "b", "location-block", "123 Main St · (555) 555-5555"),
      sec("/pricing", "c", "location-block", "123 Main St · (555) 555-5556"),  // one drifted digit
    ];
    const shared = resolveSharedComponents(fingerprintSections(sections));
    expect(shared).toHaveLength(1);
    expect(shared[0].resolution).toBe("normalized");
    expect(shared[0].canonicalText).toBe("123 Main St · (555) 555-5555");     // majority wins
    expect(shared[0].memberSectionIds).toEqual(["/:a", "/about:b", "/pricing:c"]);
  });

  it("promotes structure-identical with varying headline as props", () => {
    const sections = [
      sec("/", "a", "cta-band", "Start CrossFit today Join now Free trial available"),
      sec("/yoga", "b", "cta-band", "Start Yoga today Join now Free trial available"),
    ];
    const shared = resolveSharedComponents(fingerprintSections(sections));
    expect(shared).toHaveLength(1);
    expect(shared[0].resolution).toBe("props");
  });

  it("keeps genuinely different sections separate", () => {
    const sections = [
      sec("/", "a", "content-block", "Our story began in 2010 with two barbells"),
      sec("/about", "b", "content-block", "Memberships include all classes and open gym access"),
    ];
    expect(resolveSharedComponents(fingerprintSections(sections))).toHaveLength(0);
  });

  it("never groups sections with different tags", () => {
    const sections = [
      sec("/", "a", "cta-band", "Join now"),
      sec("/about", "b", "content-block", "Join now"),
    ];
    expect(resolveSharedComponents(fingerprintSections(sections))).toHaveLength(0);
  });
});
