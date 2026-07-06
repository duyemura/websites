import type { ScrapedWebsiteData } from "./scrape-docs";
import type {
  DesignSystemV2,
  InteractionStyle,
  ResponsiveRule,
} from "../types/design-system-v2";
import type { BrandLogo, HeadingStyle } from "./design-system";
import { buildDesignSystem as buildLegacyDesignSystem, sanitizeTokens } from "./design-system";
import {
  deriveThemeTokens,
  detectHeadingStyle,
  extractHeaderSection,
  extractFooterSection,
  extractLogo,
} from "./site-blueprint";
import type {
  ExtractArtifact,
  SegmentArtifact,
} from "../types/pipeline-artifacts";

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

function dedupeResponsiveRules(rules: ResponsiveRule[]): ResponsiveRule[] {
  const seen = new Set<string>();
  const out: ResponsiveRule[] = [];
  for (const r of rules) {
    const key = `${r.selector}::${r.property}::${r.at1440}::${r.at768 ?? ""}::${r.at375 ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function summarizeStyleDiff(
  styleDiff: Array<{
    selector: string;
    property: string;
    before: string;
    after: string;
  }>,
): { pattern: string; cssHint: string } {
  if (styleDiff.length === 0) {
    return { pattern: "generic-toggle", cssHint: "no captured diff" };
  }
  const props = styleDiff.map((d) => d.property);
  const propSet = new Set(props);
  let pattern = "generic-toggle";
  if (propSet.has("opacity") && propSet.has("transform")) pattern = "reveal-transform";
  else if (propSet.has("opacity")) pattern = "fade";
  else if (propSet.has("display") || propSet.has("visibility")) pattern = "toggle-visibility";
  else if (propSet.has("height") || propSet.has("max-height")) pattern = "expand";
  else if (propSet.has("background-color") || propSet.has("color")) pattern = "color-shift";

  const cssHint = styleDiff
    .slice(0, 3)
    .map((d) => `${d.property}: ${d.before} → ${d.after}`)
    .join("; ");
  return { pattern, cssHint };
}

/**
 * Build a DesignSystemV2 from the Extract artifact (and optionally the segment
 * artifact for header/footer shells). Unlike the scrape-based builder, this
 * consumes the full breakpoint + interaction data captured by the pipeline
 * extract stage.
 */
export function buildDesignSystemFromExtract(
  extract: ExtractArtifact,
  segment?: SegmentArtifact,
  screenshotUrl?: string | null,
  mode: DesignSystemV2["siteMetadata"]["mode"] = "replication",
): DesignSystemV2 {
  const now = new Date().toISOString();
  const firstPage = extract.pages[0];
  const businessName = firstPage?.content.businessName;

  // Use computedTheme from the extract (read via getComputedStyle in Playwright)
  // when available — this gives us the actual rendered colors and fonts for any
  // site regardless of how styles are applied (CSS files, JS, variables, etc.).
  const ct = firstPage?.computedTheme;

  const rgbToHex = (rgb: string): string | undefined => {
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return undefined;
    return `#${[m[1] ?? "0", m[2] ?? "0", m[3] ?? "0"].map(n => parseInt(n).toString(16).padStart(2, "0")).join("")}`;
  };
  const firstFont = (family: string): string =>
    family.split(",")[0]?.trim().replace(/['"]/g, "") ?? family;

  // Extract font family names from Google Fonts URLs — these are the fonts that
  // will actually be loadable in the generated site. If the computed font name
  // is a proprietary/unavailable font (e.g. Silka from Webflow's CDN), prefer
  // the Google-hosted fonts we can actually inject.
  const googleFontFamilies: string[] = (extract.css.webFontUrls ?? [])
    .flatMap(url => {
      const m = url.match(/family=([^&:]+)/);
      return m?.[1] ? [decodeURIComponent(m[1]).replace(/\+/g, " ")] : [];
    });
  const resolvedHeadingFont = googleFontFamilies[0] ?? (ct ? firstFont(ct.headingFont) : undefined);
  const resolvedBodyFont = googleFontFamilies[1] ?? googleFontFamilies[0] ?? (ct ? firstFont(ct.bodyFont) : undefined);

  // Build a light-weight ScrapedWebsiteData-like adapter to reuse
  // deriveThemeTokens/detectHeadingStyle/extractHeaderSection helpers where
  // possible. Only the fields the helpers touch need to be populated.
  const adapter: ScrapedWebsiteData = {
    url: extract.url,
    title: firstPage?.content.title ?? "",
    businessName,
    headings: firstPage?.content.headings.map((h) => h.text) ?? [],
    paragraphs: [],
    buttons: [],
    navLinks: firstPage?.content.navLinks ?? [],
    colors: ct ? ([
      { token: "bg-primary", role: "background" as const, hex: rgbToHex(ct.bodyBackground) ?? "#ffffff" },
      { token: "text-primary", role: "text" as const, hex: rgbToHex(ct.bodyColor) ?? "#000000" },
      ...(ct.primaryAccent ? [{ token: "accent-primary", role: "accent" as const, hex: rgbToHex(ct.primaryAccent) ?? ct.primaryAccent }] : []),
    ]) : [],
    fonts: (resolvedHeadingFont || resolvedBodyFont) ? [
      ...(resolvedHeadingFont ? [{ role: "heading" as const, family: resolvedHeadingFont }] : []),
      ...(resolvedBodyFont ? [{ role: "body" as const, family: resolvedBodyFont }] : []),
    ] : [],
    fontSizes: [],
    images: [],
    layoutRules: [],
    faqs: [],
    testimonials: [],
    locations: [],
    team: [],
    offerings: [],
    contact: {},
  };

  const tokens = sanitizeTokens(deriveThemeTokens(adapter));
  const headingStyle: HeadingStyle = detectHeadingStyle(adapter);
  const logo: BrandLogo = extractLogo(adapter);
  const header = extractHeaderSection(adapter);
  const footer = extractFooterSection(adapter);

  const responsive = {
    breakpoints: extract.css.breakpoints,
    rules: dedupeResponsiveRules(
      extract.pages.flatMap((p) =>
        p.responsive.map((r) => ({
          selector: r.selector,
          property: r.property,
          at1440: r.at1440,
          at768: r.at768,
          at375: r.at375,
        })),
      ),
    ),
  };

  const interactionGroups = new Map<
    string,
    InteractionStyle & { _count: number }
  >();
  for (const p of extract.pages) {
    for (const interaction of p.interactions) {
      const { pattern, cssHint } = summarizeStyleDiff(interaction.styleDiff);
      const key = `${pattern}::${interaction.trigger}::${cssHint}`;
      const existing = interactionGroups.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        interactionGroups.set(key, {
          pattern,
          trigger: interaction.trigger,
          cssHint,
          occurrences: 1,
          _count: 0,
        });
      }
    }
  }
  const interactionStyles: InteractionStyle[] = [...interactionGroups.values()].map(
    ({ pattern, trigger, cssHint, occurrences }) => ({
      pattern,
      trigger,
      cssHint,
      occurrences,
    }),
  );

  // segment currently unused for shell derivation (Playwright extract already
  // carries navLinks); keep the argument for future header/footer segment-
  // driven refinements without breaking callers.
  void segment;

  return {
    version: "2",
    siteMetadata: {
      framework: "astro",
      mode,
      targetUrl: extract.url,
      businessName,
      generatedAt: now,
    },
    global: {
      tokens,
      shell: {
        header,
        footer,
      },
      rules: {
        spacing: "Default section vertical padding derived from source; hero uses larger vertical spacing.",
        radius: tokens.radius,
        maxWidth: "max-w-6xl with responsive gutters.",
        grid: "2–3 column grids for feature lists; single column on mobile.",
        defaultTheme: tokens.colors.background === "#0A0A0A" ? "dark" : "light",
      },
    },
    responsive,
    interactionStyles,
    business: {
      name: businessName,
      tagline: undefined,
    },
    brand: { logo, headingStyle },
    reference: {
      screenshotUrl: screenshotUrl ?? firstPage?.screenshots.full1440 ?? null,
      homePagePrimaryCta: null,
    },
  };
}
