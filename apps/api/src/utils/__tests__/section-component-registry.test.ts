import { describe, test, expect } from "vitest";
import { renderSectionComponent } from "../section-component-registry";

describe("section-component-registry", () => {
  test("renders a hero section with title, subtitle, and cta", () => {
    const source = renderSectionComponent({
      id: "home-hero",
      type: "Hero",
      props: {
        title: "Train with purpose",
        subtitle: "Book your free intro session.",
        cta: { label: "Book now", href: "#book" },
      },
    });

    expect(source).toContain("Train with purpose");
    expect(source).toContain("Book your free intro session.");
    expect(source).toContain("Book now");
  });

  test("renders a text section preserving body content", () => {
    const source = renderSectionComponent({
      id: "about",
      type: "Text",
      props: {
        title: "About us",
        body: "We are a community-driven gym.",
        align: "left",
      },
    });

    expect(source).toContain("About us");
    expect(source).toContain("We are a community-driven gym.");
    expect(source).toContain("text-left");
  });

  test("renders a card group with mapped cards", () => {
    const source = renderSectionComponent({
      id: "offerings",
      type: "SiteCardGroup",
      props: {
        title: "What we offer",
        layout: "grid",
        cards: [
          { title: "CrossFit", description: "High intensity functional fitness." },
          { title: "Yoga", description: "Stretch and recover." },
        ],
      },
    });

    expect(source).toContain("What we offer");
    expect(source).toContain("CrossFit");
    expect(source).toContain("Yoga");
    expect(source).toContain("cards.map");
  });

  test("renders a fallback for unknown section types", () => {
    const source = renderSectionComponent({
      id: "plans",
      type: "Plans",
      props: { body: "Membership options" },
    });

    expect(source).toContain("Plans");
    expect(source).toContain("Membership options");
  });
});
