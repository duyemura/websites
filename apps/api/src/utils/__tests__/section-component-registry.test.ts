import { describe, test, expect } from "vitest";
import { renderSemanticSection } from "../section-component-registry";

describe("section-component-registry", () => {
  test("renders a hero section with title, subtitle, and cta", () => {
    const source = renderSemanticSection({
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

  test("renders a hero section with background image and style hint", () => {
    const source = renderSemanticSection({
      id: "home-hero",
      type: "Hero",
      props: {
        title: "Train with purpose",
        backgroundImage: "https://example.com/hero.jpg",
        styleHint: { theme: "dark", uppercase: true, bold: true, overlayOpacity: 0.4 },
      },
    });

    expect(source).toContain("https://example.com/hero.jpg");
    expect(source).toContain("uppercase");
    expect(source).toContain("font-black");
    expect(source).toContain("bg-black/[0.5]");
    expect(source).toContain("text-white");
  });

  test("renders a header with an image logo", () => {
    const source = renderSemanticSection({
      id: "header",
      type: "SiteHeader",
      props: {
        logo: { type: "image", value: "https://example.com/logo.png", alt: "Acme Gym" },
        navLinks: [{ label: "About", href: "/about" }],
      },
    });

    expect(source).toContain("https://example.com/logo.png");
    expect(source).toContain('alt={logo.alt || ""}');
    expect(source).not.toContain("Acme Gym</span>");
  });

  test("renders a header with a text logo fallback", () => {
    const source = renderSemanticSection({
      id: "header",
      type: "SiteHeader",
      props: {
        logo: { type: "text", value: "Acme Gym" },
        navLinks: [{ label: "About", href: "/about" }],
      },
    });

    expect(source).toContain("Acme Gym");
    expect(source).toContain('logo?.type === "image"');
    expect(source).toContain('{logo?.value ?? ""}');
  });

  test("throws for non-semantic section types", () => {
    expect(() =>
      renderSemanticSection({
        id: "about",
        type: "Text",
        props: { title: "About us", body: "We are a community-driven gym." },
      }),
    ).toThrow("Non-semantic section type cannot be rendered by shell renderer: Text");
  });
});
