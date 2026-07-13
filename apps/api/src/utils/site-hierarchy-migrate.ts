import type { TemplateShellPage } from "@milo/shared-types";
import type { SiteBlueprint } from "./site-blueprint";
import type { CanonicalSectionTag, HierarchyPage, HierarchySection, SiteHierarchy } from "../types/site-hierarchy";
import type { DesignSystemV2 } from "../types/design-system-v2";

function inferTagFromLegacyType(type: string): CanonicalSectionTag {
  const lower = type.toLowerCase();
  if (lower.includes("hero")) return "hero";
  if (lower.includes("header")) return "header";
  if (lower.includes("footer")) return "footer";
  if (lower.includes("cta")) return "cta-band";
  if (lower.includes("card") || lower.includes("plan") || lower.includes("feature")) return "feature-grid";
  if (lower.includes("testimonial") || lower.includes("review")) return "testimonial-band";
  if (lower.includes("location")) return "location-block";
  if (lower.includes("faq")) return "faq-block";
  if (lower.includes("step") || lower.includes("process")) return "steps-band";
  if (lower.includes("image") || lower.includes("gallery") || lower.includes("media")) return "media-block";
  if (lower === "text" || lower === "siteblock") return "content-block";
  return "unknown";
}

function pickValidCta(value: unknown): { label: string; href: string } | null {
  if (!value || typeof value !== "object") return null;
  const cta = value as Record<string, unknown>;
  if (typeof cta.label === "string" && typeof cta.href === "string") {
    return { label: cta.label, href: cta.href };
  }
  return null;
}

function migrateSection(section: { id: string; type: string; props?: Record<string, unknown> }, pageSlug: string): HierarchySection {
  const props = section.props ?? {};
  const tag = inferTagFromLegacyType(section.type);

  const content: HierarchySection["content"] = {};
  if (typeof props.title === "string") content.heading = props.title;
  else if (typeof props.heading === "string") content.heading = props.heading;
  else if (typeof props.headline === "string") content.heading = props.headline;

  if (typeof props.subtitle === "string") content.body = props.subtitle;
  else if (typeof props.body === "string") content.body = props.body;
  else if (typeof props.description === "string") content.body = props.description;

  if (typeof props.eyebrow === "string") content.eyebrow = props.eyebrow;
  else if (typeof props.kicker === "string") content.eyebrow = props.kicker;
  else if (typeof props.label === "string") content.eyebrow = props.label;

  const styleHint =
    props.styleHint && typeof props.styleHint === "object"
      ? (props.styleHint as HierarchySection["styleHint"])
      : undefined;
  if (!content.eyebrow && typeof styleHint?.eyebrow === "string") {
    content.eyebrow = styleHint.eyebrow;
  }

  if (Array.isArray(props.items) && props.items.length > 0) {
    content.items = props.items.map((item: { title?: string; description?: string; imageUrl?: string }) => ({
      title: item.title,
      description: item.description,
      imageUrl: item.imageUrl,
    }));
  }
  if (Array.isArray(props.images) && props.images.length > 0) {
    content.images = props.images.map(
      (img: { url: string; alt?: string; context?: string } | string) =>
        typeof img === "string" ? { url: img } : { url: img.url, alt: img.alt, context: img.context },
    );
  } else if (typeof props.imageUrl === "string") {
    content.images = [{ url: props.imageUrl }];
  } else if (typeof props.backgroundImage === "string") {
    content.images = [{ url: props.backgroundImage, context: "background" }];
  }

  const cta = pickValidCta(props.cta);
  if (cta) {
    content.cta = cta;
  }

  return {
    id: section.id,
    tag,
    intent: `Migrated from legacy blueprint section type ${section.type}`,
    content,
    styleHint,
    evidenceId: `legacy-${pageSlug}-${section.id}`,
  };
}

function migratePage(page: TemplateShellPage): HierarchyPage {
  return {
    slug: page.slug,
    isHomePage: page.isHomePage,
    title: page.title,
    metaTitle: page.metaTitle,
    metaDescription: page.metaDescription,
    primaryCta: page.primaryCta,
    sections: page.sections
      .map((s) => migrateSection(s as { id: string; type: string; props?: Record<string, unknown> }, page.slug))
      .filter((s) => s.tag !== "header" && s.tag !== "footer"),
  };
}

export function migrateBlueprintToHierarchy(blueprint: SiteBlueprint): {
  hierarchy: SiteHierarchy;
  designSystem: DesignSystemV2;
} {
  const generatedAt = blueprint.site_metadata.generated_at;
  const mode = blueprint.site_metadata.mode;
  const targetUrl = blueprint.site_metadata.target_url;
  const businessName = blueprint.site_metadata.business_name;

  const hierarchy: SiteHierarchy = {
    version: "1",
    siteMetadata: {
      framework: "astro",
      mode,
      targetUrl,
      businessName,
      generatedAt,
    },
    pages: blueprint.pages.map(migratePage),
    buildPlan: {
      nextPage: blueprint.build_plan.next_page,
      pageStatus: { ...blueprint.build_plan.page_status },
      buildOrder: [...blueprint.build_plan.build_order],
    },
  };

  const headerSection = blueprint.global_shell.header;
  const footerSection = blueprint.global_shell.footer;
  const homePage = blueprint.pages.find((p) => p.isHomePage);
  const heroSection = homePage?.sections.find((s) => inferTagFromLegacyType(s.type) === "hero");

  const designSystem: DesignSystemV2 = {
    version: "2",
    siteMetadata: {
      framework: "astro",
      mode,
      targetUrl,
      businessName,
      generatedAt,
    },
    global: {
      tokens: blueprint.design_tokens,
      shell: {
        header: headerSection,
        footer: footerSection,
      },
      rules: {
        spacing: "Default section vertical padding derived from source; hero uses larger vertical spacing.",
        radius: blueprint.design_tokens.radius,
        maxWidth: "max-w-6xl with responsive gutters.",
        grid: "2–3 column grids for feature lists; single column on mobile.",
        defaultTheme: blueprint.design_tokens.colors.background === "#0A0A0A" ? "dark" : "light",
      },
    },
    business: { name: businessName },
    brand: {
      logo: blueprint.brand_identity.logo,
      headingStyle: blueprint.brand_identity.heading_style,
    },
    reference: {
      screenshotUrl: null,
      homePagePrimaryCta: heroSection ? pickValidCta(heroSection.props?.cta) : null,
    },
  };

  return { hierarchy, designSystem };
}
