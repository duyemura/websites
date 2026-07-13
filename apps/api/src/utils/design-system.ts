import type { SiteSection, ThemeTokens } from "@milo/shared-types";

const CSS_ARTIFACT_PATTERN = /^\s*[*.#[@:\w-]+\s*\{/;
const MAX_NAV_LABEL_LENGTH = 60;

function isCleanNavLink(link: { label: string; href: string }): boolean {
  const label = link.label.trim();
  if (!label || label.length > MAX_NAV_LABEL_LENGTH) return false;
  if (CSS_ARTIFACT_PATTERN.test(label)) return false;
  if (label.startsWith("<") || label.startsWith("{") || label.startsWith("//")) return false;
  return true;
}

function titleCaseNavLabel(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 1) return word.toLowerCase();
      // Preserve existing mixed-case/acronym words (e.g., iOS, API, SaaS).
      if (!/^[a-z][a-z]*$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function cleanNavLinks(links: { label: string; href: string }[]): { label: string; href: string }[] {
  return links
    .filter(isCleanNavLink)
    .map((link) => ({ label: titleCaseNavLabel(link.label.trim()), href: link.href }));
}

function asNavLinks(value: unknown): { label: string; href: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { label: string; href: string } =>
      item && typeof item === "object" && typeof item.label === "string" && typeof item.href === "string",
  );
}

function cleanShellSection(section?: SiteSection): SiteSection | undefined {
  if (!section) return undefined;
  return {
    ...section,
    props: {
      ...section.props,
      navLinks: cleanNavLinks(asNavLinks(section.props.navLinks)),
    },
  };
}

export interface BrandLogo {
  type: "image" | "text";
  value: string;
  alt?: string;
}

export interface HeadingStyle {
  /** Whether headings use all-caps. */
  uppercase: boolean;
  /** Whether headings use a heavy weight (700+). */
  bold: boolean;
  /** Whether headings use a condensed/narrow face. */
  condensed?: boolean;
}

export interface DesignSystem {
  version: "1";
  siteMetadata: {
    framework: string;
    mode: string;
    targetUrl: string;
    businessName?: string;
    generatedAt: string;
  };
  global: {
    tokens: ThemeTokens;
    shell: {
      header?: SiteSection;
      footer?: SiteSection;
      navLinks: { label: string; href: string }[];
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
    /** Generic section order inferred from the source DOM. */
    sectionOrder?: string[];
    /** Homepage primary CTA, reused in the global header. */
    homePagePrimaryCta?: { label: string; href: string } | null;
  };
}

export interface BuildDesignSystemInput {
  blueprint: {
    site_metadata: {
      framework: string;
      mode: string;
      target_url: string;
      business_name?: string;
      generated_at: string;
    };
    design_tokens: ThemeTokens;
    global_shell: {
      header?: SiteSection;
      footer?: SiteSection;
      navLinks: { label: string; href: string }[];
    };
  };
  brand?: {
    logo?: BrandLogo;
    headingStyle?: HeadingStyle;
  };
  referenceScreenshotUrl?: string | null;
  sectionOrder?: string[];
  homePagePrimaryCta?: { label: string; href: string } | null;
}

function hexLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6) return 0.5;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0.5;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function adjustHex(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(parseInt(full.slice(0, 2), 16) + amount);
  const g = clamp(parseInt(full.slice(2, 4), 16) + amount);
  const b = clamp(parseInt(full.slice(4, 6), 16) + amount);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function contrastingForeground(hex: string): string {
  return hexLuminance(hex) < 0.5 ? "#FFFFFF" : "#000000";
}

function luminanceContrast(a: string, b: string): number {
  return Math.abs(hexLuminance(a) - hexLuminance(b));
}

export function sanitizeTokens(tokens: ThemeTokens): ThemeTokens {
  const colors = { ...tokens.colors };

  // If the primary accent equals the foreground text color, it will disappear
  // on buttons/CTAs. Replace it with a neutral default that still contrasts
  // with the page background.
  if (colors.primary.toUpperCase() === colors.foreground.toUpperCase()) {
    colors.primary = contrastingForeground(colors.background);
  }

  // Only recalculate the foreground on primary when the provided value would
  // be unreadable against the primary color.
  if (luminanceContrast(colors.primaryForeground, colors.primary) < 0.3) {
    colors.primaryForeground = contrastingForeground(colors.primary);
  }

  // If the muted surface is too close to the background, derive a step from
  // the background so cards and borders remain visible.
  const bgLum = hexLuminance(colors.background);
  const mutedLum = hexLuminance(colors.muted);
  if (Math.abs(mutedLum - bgLum) < 0.08) {
    colors.muted = adjustHex(colors.background, bgLum < 0.5 ? 18 : -18);
  }

  // Only recalculate muted foreground when it lacks contrast with the surface.
  if (luminanceContrast(colors.mutedForeground, colors.muted) < 0.3) {
    colors.mutedForeground = contrastingForeground(colors.muted) === "#FFFFFF" ? "#A3A3A3" : "#525252";
  }

  return { ...tokens, colors };
}

export function buildDesignSystem(input: BuildDesignSystemInput): DesignSystem {
  const { blueprint, brand = {}, referenceScreenshotUrl, sectionOrder, homePagePrimaryCta } = input;
  const cleanLinks = cleanNavLinks(blueprint.global_shell.navLinks);
  const tokens = sanitizeTokens(blueprint.design_tokens);
  return {
    version: "1",
    siteMetadata: {
      framework: blueprint.site_metadata.framework,
      mode: blueprint.site_metadata.mode,
      targetUrl: blueprint.site_metadata.target_url,
      businessName: blueprint.site_metadata.business_name,
      generatedAt: blueprint.site_metadata.generated_at,
    },
    global: {
      tokens,
      shell: {
        header: cleanShellSection(blueprint.global_shell.header),
        footer: cleanShellSection(blueprint.global_shell.footer),
        navLinks: cleanLinks,
      },
    },
    business: {
      name: blueprint.site_metadata.business_name,
      tagline: undefined,
    },
    brand: {
      logo: brand.logo ?? { type: "text", value: blueprint.site_metadata.business_name ?? blueprint.site_metadata.target_url },
      headingStyle: brand.headingStyle ?? { uppercase: false, bold: true },
    },
    reference: {
      screenshotUrl: referenceScreenshotUrl ?? null,
      sectionOrder,
      homePagePrimaryCta: homePagePrimaryCta ?? null,
    },
  };
}
