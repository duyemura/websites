import type { ScrapedWebsiteData } from "./scrape-docs";
import type { DesignSystemV2 } from "../types/design-system-v2";
import type { BrandLogo, HeadingStyle } from "./design-system";
import { buildDesignSystem as buildLegacyDesignSystem, sanitizeTokens } from "./design-system";
import {
  deriveThemeTokens,
  detectHeadingStyle,
  extractHeaderSection,
  extractFooterSection,
  extractLogo,
} from "./site-blueprint";

export function buildDesignSystemV2(
  data: ScrapedWebsiteData,
  screenshotUrl?: string | null,
  mode: DesignSystemV2["siteMetadata"]["mode"] = "replication",
): DesignSystemV2 {
  const tokens = sanitizeTokens(deriveThemeTokens(data));
  const header = extractHeaderSection(data);
  const footer = extractFooterSection(data);
  const headingStyle: HeadingStyle = detectHeadingStyle(data);
  const logo: BrandLogo = extractLogo(data);
  const homePagePrimaryCta = data.sections?.find((s) => s.type.toLowerCase().includes("hero"))?.cta;

  const legacy = buildLegacyDesignSystem({
    blueprint: {
      site_metadata: {
        framework: "astro",
        mode,
        target_url: data.url,
        business_name: data.businessName,
        generated_at: new Date().toISOString(),
      },
      design_tokens: tokens,
      global_shell: {
        header,
        footer,
        navLinks: data.navLinks,
      },
    },
    brand: { logo, headingStyle },
    referenceScreenshotUrl: screenshotUrl,
    homePagePrimaryCta,
  });

  return {
    version: "2",
    siteMetadata: legacy.siteMetadata as DesignSystemV2["siteMetadata"],
    global: {
      tokens,
      shell: {
        header: legacy.global.shell.header,
        footer: legacy.global.shell.footer,
        navLinks: legacy.global.shell.navLinks,
      },
      rules: {
        spacing: "Default section vertical padding derived from source; hero uses larger vertical spacing.",
        radius: tokens.radius,
        maxWidth: "max-w-6xl with responsive gutters.",
        grid: "2–3 column grids for feature lists; single column on mobile.",
        defaultTheme: tokens.colors.background === "#0A0A0A" ? "dark" : "light",
      },
    },
    business: legacy.business,
    brand: legacy.brand,
    reference: { screenshotUrl, homePagePrimaryCta: legacy.reference.homePagePrimaryCta },
  };
}
