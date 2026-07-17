// apps/api/src/services/eval/__tests__/content-sections.test.ts
import { describe, it, expect } from "vitest";
import { findShallowSections } from "../checks/content.js";

describe("findShallowSections", () => {
  it("flags a content section with a heading and almost no body copy", () => {
    const html = `
      <section data-section="story">
        <h2>Our story</h2>
        <p>Short.</p>
      </section>
    `;
    const shallow = findShallowSections(html);
    expect(shallow).toHaveLength(1);
    expect(shallow[0].heading).toBe("Our story");
  });

  it("skips hero sections", () => {
    const html = `
      <section data-section="hero">
        <h1>Welcome</h1>
      </section>
    `;
    const shallow = findShallowSections(html);
    expect(shallow).toHaveLength(0);
  });

  it("skips legitimate CTA bands by data-section-tag", () => {
    const html = `
      <section data-section="ctaBand" data-section-tag="cta-band">
        <h2>Your Fitness Journey Starts Here</h2>
        <p>Schedule your free tour today and experience the difference.</p>
        <a href="/contact">Schedule Your Free Tour</a>
      </section>
    `;
    const shallow = findShallowSections(html);
    expect(shallow).toHaveLength(0);
  });

  it("skips legitimate CTA bands by data-section name", () => {
    const html = `
      <section data-section="ctaBand">
        <h2>Book your free intro</h2>
        <p>Schedule your free tour today and experience the difference.</p>
        <a href="/contact">Schedule Your Free Tour</a>
      </section>
    `;
    const shallow = findShallowSections(html);
    expect(shallow).toHaveLength(0);
  });

  it("skips heading-only call-outs with a single CTA", () => {
    const html = `
      <section data-section="promo">
        <h2>Join today</h2>
        <a href="/contact">Get started</a>
      </section>
    `;
    const shallow = findShallowSections(html);
    expect(shallow).toHaveLength(0);
  });
});
