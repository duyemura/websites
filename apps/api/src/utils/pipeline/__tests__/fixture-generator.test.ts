import { describe, it, expect } from "vitest";
import { buildFixture } from "../fixture-generator";
import type { SynthesizeArtifact } from "../../../types/pipeline-artifacts";

const makeArtifact = (tags: string[]): SynthesizeArtifact =>
  ({
    templateName: "test",
    components: tags.map((tag, i) => ({
      name: `Component${i}`,
      tag,
      archetype: tag,
      code: "",
      cropDesktop: "",
      exemplarPage: "/",
    })),
    specSource: "",
    docs: { personality: "", components: "", pageArchetypes: "" },
    cssSource: "",
    pageMap: {},
  }) as SynthesizeArtifact;

describe("buildFixture", () => {
  it("returns a valid GymSiteContent shape for an empty component list", () => {
    const fixture = buildFixture(makeArtifact([]));
    // Top-level structural check (no Zod schema — interface only)
    expect(fixture).toHaveProperty("meta");
    expect(fixture).toHaveProperty("business");
    expect(fixture).toHaveProperty("brand");
    expect(fixture).toHaveProperty("navigation");
    expect(fixture).toHaveProperty("pages");
    expect(fixture.pages).toHaveProperty("home");
    expect(fixture.pages).toHaveProperty("about");
    expect(fixture.pages).toHaveProperty("pricing");
    expect(fixture.pages).toHaveProperty("contact");
    expect(fixture.pages).toHaveProperty("schedule");
    expect(fixture.pages).toHaveProperty("blog");
    expect(Array.isArray(fixture.pages.programs)).toBe(true);
    expect(Array.isArray(fixture.pages.legal)).toBe(true);
  });

  it("meta fields are populated correctly", () => {
    const fixture = buildFixture(makeArtifact([]));
    expect(typeof fixture.meta.siteId).toBe("string");
    expect(typeof fixture.meta.apiBaseUrl).toBe("string");
    expect(typeof fixture.meta.siteUrl).toBe("string");
    expect(typeof fixture.meta.defaultTitle).toBe("string");
    expect(typeof fixture.meta.defaultDescription).toBe("string");
    expect(fixture.meta.preview).toBe(true);
    // templateName "test" is passed through (even if not a known theme)
    expect(typeof fixture.meta.templateTheme).toBe("string");
  });

  // --- testimonial-band ---

  it("includes testimonials when testimonial-band is detected", () => {
    const fixture = buildFixture(makeArtifact(["testimonial-band"]));
    expect(fixture.pages.home.testimonials.length).toBeGreaterThan(0);
  });

  it("uses empty testimonials when no testimonial-band is detected", () => {
    const fixture = buildFixture(makeArtifact(["hero"]));
    expect(fixture.pages.home.testimonials).toEqual([]);
  });

  // --- faq-block ---

  it("includes FAQ when faq-block is detected", () => {
    const fixture = buildFixture(makeArtifact(["faq-block"]));
    expect(fixture.pages.home.faq.length).toBeGreaterThan(0);
  });

  it("uses empty FAQ when no faq-block is detected", () => {
    const fixture = buildFixture(makeArtifact(["hero"]));
    expect(fixture.pages.home.faq).toEqual([]);
  });

  // --- feature-grid / programs ---

  it("includes featuredPrograms when feature-grid is detected", () => {
    const fixture = buildFixture(makeArtifact(["feature-grid"]));
    expect(fixture.pages.home.featuredPrograms.length).toBeGreaterThan(0);
    expect(fixture.pages.programs.length).toBeGreaterThan(0);
  });

  it("uses empty featuredPrograms when no feature-grid is detected", () => {
    const fixture = buildFixture(makeArtifact([]));
    expect(fixture.pages.home.featuredPrograms).toEqual([]);
    expect(fixture.pages.programs).toEqual([]);
  });

  // --- iframe ---

  it("includes schedule iframes when iframe is detected", () => {
    const fixture = buildFixture(makeArtifact(["iframe"]));
    expect(fixture.pages.schedule.iframes).toBeDefined();
    expect(fixture.pages.schedule.iframes!.length).toBeGreaterThan(0);
    expect(fixture.pages.home.iframes).toBeDefined();
    expect(fixture.pages.home.iframes!.length).toBeGreaterThan(0);
  });

  it("omits iframes when no iframe component is detected", () => {
    const fixture = buildFixture(makeArtifact(["hero"]));
    expect(fixture.pages.schedule.iframes).toBeUndefined();
    expect(fixture.pages.home.iframes).toBeUndefined();
  });

  // --- team ---

  it("includes 2 coaches when team component is detected", () => {
    const fixture = buildFixture(makeArtifact(["team"]));
    expect(fixture.pages.about.team.length).toBe(2);
  });

  it("includes 1 coach stub when no team component is detected", () => {
    const fixture = buildFixture(makeArtifact([]));
    expect(fixture.pages.about.team.length).toBe(1);
  });

  // --- about-page optional fields ---

  it("populates about.testimonials when testimonial-band is detected", () => {
    const fixture = buildFixture(makeArtifact(["testimonial-band"]));
    expect(fixture.pages.about.testimonials).toBeDefined();
    expect(fixture.pages.about.testimonials!.length).toBeGreaterThan(0);
  });

  it("omits about.testimonials when no testimonial-band is detected", () => {
    const fixture = buildFixture(makeArtifact([]));
    expect(fixture.pages.about.testimonials).toBeUndefined();
  });

  it("populates about.faq when faq-block is detected", () => {
    const fixture = buildFixture(makeArtifact(["faq-block"]));
    expect(fixture.pages.about.faq).toBeDefined();
    expect(fixture.pages.about.faq!.length).toBeGreaterThan(0);
  });

  it("omits about.faq when no faq-block is detected", () => {
    const fixture = buildFixture(makeArtifact([]));
    expect(fixture.pages.about.faq).toBeUndefined();
  });

  // --- steps-band ---

  it("includes howItWorks steps when steps-band is detected", () => {
    const fixture = buildFixture(makeArtifact(["steps-band"]));
    expect(fixture.pages.home.howItWorks.length).toBeGreaterThan(0);
  });

  it("uses empty howItWorks when no steps-band is detected", () => {
    const fixture = buildFixture(makeArtifact([]));
    expect(fixture.pages.home.howItWorks).toEqual([]);
  });
});
