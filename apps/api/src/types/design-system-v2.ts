import type { SiteSection, ThemeTokens } from "@ploy-gyms/shared-types";
import type { BrandLogo, HeadingStyle } from "../utils/design-system";

export interface DesignSystemV2 {
  version: "2";
  siteMetadata: {
    framework: "astro";
    mode: "replication" | "template" | "greenfield";
    targetUrl?: string;
    businessName?: string;
    generatedAt: string;
  };
  global: {
    tokens: ThemeTokens;
    shell: {
      header?: SiteSection; // SiteHeader only
      footer?: SiteSection; // SiteFooter only
      navLinks: { label: string; href: string }[];
    };
    rules: {
      spacing?: string;
      radius?: string;
      maxWidth?: string;
      grid?: string;
      defaultTheme?: "dark" | "light";
    };
  };
  business: {
    name?: string;
    tagline?: string;
  };
  brand: {
    logo: BrandLogo;
    headingStyle: HeadingStyle;
  };
  reference: {
    screenshotUrl?: string | null;
  };
}
