import { describe, test, expect } from "vitest";
import { buildDesignSystem, sanitizeTokens, type DesignSystem } from "../design-system";
import { deriveThemeTokens } from "../site-blueprint";
import type { ThemeTokens, SiteSection } from "@ploy-gyms/shared-types";

const tokens: ThemeTokens = {
  colors: {
    primary: "#ff0000",
    primaryForeground: "#ffffff",
    background: "#fafafa",
    foreground: "#111111",
    muted: "#f3f3f3",
    mutedForeground: "#666666",
    border: "#e5e5e5",
  },
  fonts: {
    heading: "Inter",
    body: "Inter",
  },
  radius: "0.5rem",
};

const header: SiteSection = {
  id: "header",
  type: "SiteHeader",
  props: {
    logo: { type: "text", value: "Acme Gym" },
    navLinks: [{ label: "About", href: "/about" }],
  },
};

const footer: SiteSection = {
  id: "footer",
  type: "SiteFooter",
  props: {
    businessName: "Acme Gym",
    navLinks: [{ label: "Contact", href: "/contact" }],
    copyright: "© 2026 Acme Gym. All rights reserved.",
  },
};

const blueprint = {
  site_metadata: {
    framework: "astro",
    mode: "replication",
    target_url: "https://example.com",
    business_name: "Acme Gym",
    generated_at: "2026-07-01T00:00:00.000Z",
  },
  design_tokens: tokens,
  global_shell: {
    header,
    footer,
    navLinks: [{ label: "Home", href: "/" }],
  },
};

describe("design-system", () => {
  test("buildDesignSystem locks global tokens and shell", () => {
    const designSystem = buildDesignSystem({ blueprint, referenceScreenshotUrl: "https://cdn.example.com/ref.png" });

    expect(designSystem.version).toBe("1");
    expect(designSystem.siteMetadata.framework).toBe("astro");
    expect(designSystem.siteMetadata.mode).toBe("replication");
    expect(designSystem.global.tokens).toEqual(sanitizeTokens(tokens));
    expect(designSystem.global.shell.header).toEqual(header);
    expect(designSystem.global.shell.footer).toEqual(footer);
    expect(designSystem.global.shell.navLinks).toEqual([{ label: "Home", href: "/" }]);
  });

  test("buildDesignSystem carries business context and reference screenshot", () => {
    const designSystem = buildDesignSystem({ blueprint, referenceScreenshotUrl: "https://cdn.example.com/ref.png" });

    expect(designSystem.business.name).toBe("Acme Gym");
    expect(designSystem.reference.screenshotUrl).toBe("https://cdn.example.com/ref.png");
  });

  test("buildDesignSystem allows null reference screenshot", () => {
    const designSystem = buildDesignSystem({ blueprint, referenceScreenshotUrl: null });

    expect(designSystem.reference.screenshotUrl).toBeNull();
  });

  test("buildDesignSystem defaults brand identity from blueprint tokens", () => {
    const designSystem = buildDesignSystem({ blueprint });

    expect(designSystem.brand.logo).toEqual({
      type: "text",
      value: "Acme Gym",
    });
    expect(designSystem.brand.headingStyle).toEqual({ uppercase: false, bold: true });
  });

  test("buildDesignSystem accepts explicit brand identity and section order", () => {
    const designSystem = buildDesignSystem({
      blueprint,
      brand: {
        logo: { type: "image", value: "https://cdn.example.com/logo.png", alt: "Acme Gym" },
        headingStyle: { uppercase: true, bold: true, condensed: true },
      },
      sectionOrder: ["Hero", "Text", "SiteCardGroup"],
    });

    expect(designSystem.brand.logo).toEqual({
      type: "image",
      value: "https://cdn.example.com/logo.png",
      alt: "Acme Gym",
    });
    expect(designSystem.brand.headingStyle).toEqual({
      uppercase: true,
      bold: true,
      condensed: true,
    });
    expect(designSystem.reference.sectionOrder).toEqual(["Hero", "Text", "SiteCardGroup"]);
  });

  test("buildDesignSystem preserves provided tokens without mode adjustment", () => {
    const darkBlueprint = {
      ...blueprint,
      design_tokens: {
        ...tokens,
        colors: {
          ...tokens.colors,
          background: "#111111",
          foreground: "#ffffff",
        },
      },
    };
    const designSystem = buildDesignSystem({ blueprint: darkBlueprint });
    expect(designSystem.global.tokens.colors.background).toBe("#111111");
    expect(designSystem.global.tokens.colors.foreground).toBe("#ffffff");
  });

  test("DesignSystem type accepts required shape", () => {
    const ds: DesignSystem = buildDesignSystem({ blueprint });
    expect(ds.siteMetadata.targetUrl).toBe("https://example.com");
    expect(ds.siteMetadata.generatedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(ds.brand.headingStyle).toBeDefined();
  });
});

describe("deriveThemeTokens", () => {
  test("uses scraped accent as primary", () => {
    const tokens = deriveThemeTokens({
      url: "https://example.com",
      title: "",
      businessName: "",
      headings: [],
      paragraphs: [],
      buttons: [],
      navLinks: [],
      colors: [
        { role: "background", hex: "#ffffff", token: "bg" },
        { role: "text", hex: "#111111", token: "text" },
        { role: "accent", hex: "#0063ff", token: "accent" },
      ],
      fonts: [],
      fontSizes: [],
      images: [],
      layoutRules: [],
      faqs: [],
      testimonials: [],
      locations: [],
      team: [],
      offerings: [],
      contact: {},
    } as any);
    expect(tokens.colors.primary).toBe("#0063ff");
  });

  test("prefers most saturated palette color over dark body text when accent is missing", () => {
    const tokens = deriveThemeTokens({
      url: "https://example.com",
      title: "",
      businessName: "",
      headings: [],
      paragraphs: [],
      buttons: [],
      navLinks: [],
      colors: [
        { role: "background", hex: "#ffffff", token: "bg" },
        { role: "text", hex: "#111111", token: "text" },
        { role: "surface", hex: "#f5f5f5", token: "surface" },
        { role: "border", hex: "#e5e5e5", token: "border" },
        { role: "unknown", hex: "#2563ff", token: "brand" },
      ],
      fonts: [],
      fontSizes: [],
      images: [],
      layoutRules: [],
      faqs: [],
      testimonials: [],
      locations: [],
      team: [],
      offerings: [],
      contact: {},
    } as any);
    expect(tokens.colors.primary).toBe("#2563ff");
  });

  test("falls back to neutral when no accent and only dark neutrals exist", () => {
    const tokens = deriveThemeTokens({
      url: "https://example.com",
      title: "",
      businessName: "",
      headings: [],
      paragraphs: [],
      buttons: [],
      navLinks: [],
      colors: [
        { role: "background", hex: "#ffffff", token: "bg" },
        { role: "text", hex: "#171717", token: "text" },
      ],
      fonts: [],
      fontSizes: [],
      images: [],
      layoutRules: [],
      faqs: [],
      testimonials: [],
      locations: [],
      team: [],
      offerings: [],
      contact: {},
    } as any);
    expect(tokens.colors.primary).toBe("#171717");
  });
});
