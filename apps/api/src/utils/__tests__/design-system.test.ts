import { describe, test, expect } from "vitest";
import { buildDesignSystem, type DesignSystem } from "../design-system";
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
    expect(designSystem.global.tokens).toEqual(tokens);
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

  test("DesignSystem type accepts required shape", () => {
    const ds: DesignSystem = buildDesignSystem({ blueprint });
    expect(ds.siteMetadata.targetUrl).toBe("https://example.com");
    expect(ds.siteMetadata.generatedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});
