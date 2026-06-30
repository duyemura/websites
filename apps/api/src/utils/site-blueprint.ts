import type { ScrapedWebsiteData } from "./scrape-docs";
import type {
  SiteSection,
  TemplateShellPage,
  ThemeTokens,
} from "@ploy-gyms/shared-types";
import { buildTemplateShell } from "./template-shell";

const NEUTRAL_TOKENS: ThemeTokens = {
  colors: {
    primary: "#111111",
    primaryForeground: "#ffffff",
    background: "#ffffff",
    foreground: "#171717",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    border: "#e5e5e5",
  },
  fonts: {
    heading: "Sans-serif",
    body: "Sans-serif",
  },
  radius: "0.5rem",
};

export interface SiteBlueprint {
  site_metadata: {
    framework: "astro";
    mode: "replication";
    target_url: string;
    business_name?: string;
    generated_at: string;
  };
  design_tokens: ThemeTokens;
  global_shell: {
    theme: ThemeTokens;
    header?: SiteSection;
    footer?: SiteSection;
    navLinks: { label: string; href: string }[];
  };
  pages: TemplateShellPage[];
}

function buildDesignTokens(data: ScrapedWebsiteData): ThemeTokens {
  const text = data.colors.find((c) => c.role === "text")?.hex;
  const bg = data.colors.find((c) => c.role === "background")?.hex;
  const accent = data.colors.find((c) => c.role === "accent")?.hex;
  const muted = data.colors.find((c) => c.role === "textMuted")?.hex;
  const border = data.colors.find((c) => c.role === "border")?.hex;
  const headingFont = data.fonts.find((f) => f.role === "heading")?.family;
  const bodyFont = data.fonts.find((f) => f.role === "body")?.family;
  const radius =
    data.designTokens?.find((t) => t.category === "radius")?.value ??
    NEUTRAL_TOKENS.radius;

  return {
    colors: {
      primary: accent ?? text ?? NEUTRAL_TOKENS.colors.primary,
      primaryForeground: bg ?? NEUTRAL_TOKENS.colors.primaryForeground,
      background: bg ?? NEUTRAL_TOKENS.colors.background,
      foreground: text ?? NEUTRAL_TOKENS.colors.foreground,
      muted: muted ?? NEUTRAL_TOKENS.colors.muted,
      mutedForeground: muted ?? NEUTRAL_TOKENS.colors.mutedForeground,
      border: border ?? NEUTRAL_TOKENS.colors.border,
    },
    fonts: {
      heading: headingFont ?? NEUTRAL_TOKENS.fonts.heading,
      body: bodyFont ?? NEUTRAL_TOKENS.fonts.body,
    },
    radius,
  };
}

function deriveSlug(href: string, fallback: string): string {
  try {
    if (href.startsWith("/")) {
      const slug = href.replace(/^\/+/, "").split("/")[0];
      if (slug) return slug;
    }
    const url = new URL(href);
    const slug = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (slug) return slug;
  } catch {
    // fall through to fallback
  }
  return (
    fallback.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "page"
  );
}

function makeTextSection(
  title: string,
  body: string,
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "Text",
    props: { title, body, align: "center" },
  };
}

function makeCardGroupSection(
  title: string,
  items: { title?: string; description?: string }[],
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteCardGroup",
    props: {
      title,
      layout: items.length >= 3 ? "grid" : "row",
      cards: items.map((item) => ({
        title: item.title,
        description: item.description,
      })),
    },
  };
}

function makeReviewsSection(
  testimonials: { quote: string; author?: string; role?: string }[],
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteReviews",
    props: {
      title: "What members say",
      reviews: testimonials.map((t) => ({
        quote: t.quote,
        author: [t.author, t.role].filter(Boolean).join(", "),
      })),
    },
  };
}

function makeLocationSection(
  locations: { name?: string; address?: string }[],
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteLocation",
    props: {
      title: "Visit us",
      address: locations
        .map((loc) => [loc.name, loc.address].filter(Boolean).join(" — "))
        .join("\n"),
      hours: "",
      phone: "",
      mapLink: "#map",
    },
  };
}

function inferSecondaryPage(
  link: { label: string; href: string },
  data: ScrapedWebsiteData,
): TemplateShellPage {
  const slug = deriveSlug(link.href, link.label);
  const title = link.label;
  const label = link.label.toLowerCase();
  const sections: SiteSection[] = [];
  const sectionId = (prefix: string) => `${slug}-${prefix}`;

  if (
    label.includes("class") ||
    label.includes("service") ||
    label.includes("program") ||
    label.includes("membership") ||
    label.includes("pricing")
  ) {
    if (data.offerings.length > 0) {
      sections.push(
        makeCardGroupSection(title, data.offerings, sectionId("offerings")),
      );
    }
  } else if (
    label.includes("coach") ||
    label.includes("team") ||
    label.includes("trainer") ||
    label.includes("staff")
  ) {
    if (data.team.length > 0) {
      sections.push(
        makeCardGroupSection(
          title,
          data.team.map((member) => ({
            title: member.name,
            description: member.bio,
          })),
          sectionId("team"),
        ),
      );
    }
  } else if (
    label.includes("about") ||
    label.includes("story") ||
    label.includes("mission")
  ) {
    const body =
      data.description ||
      data.paragraphs.slice(0, 2).join("\n\n") ||
      "";
    if (body) {
      sections.push(makeTextSection(title, body, sectionId("about")));
    }
  } else if (
    label.includes("contact") ||
    label.includes("location") ||
    label.includes("visit") ||
    label.includes("find us")
  ) {
    if (data.locations.length > 0) {
      sections.push(makeLocationSection(data.locations, sectionId("location")));
    }
  } else if (
    label.includes("testimonial") ||
    label.includes("review") ||
    label.includes("result")
  ) {
    if (data.testimonials.length > 0) {
      sections.push(makeReviewsSection(data.testimonials, sectionId("reviews")));
    }
  }

  if (sections.length === 0) {
    const body = data.description || data.paragraphs[0] || "";
    if (body) {
      sections.push(makeTextSection(title, body, sectionId("content")));
    }
  }

  return {
    slug,
    title,
    isHomePage: false,
    metaTitle: title,
    sections,
  };
}

export function buildSiteBlueprint(data: ScrapedWebsiteData): SiteBlueprint {
  const tokens = buildDesignTokens(data);
  const homeShell = buildTemplateShell(data);
  const header = homeShell.page.sections.find((s) => s.type === "SiteHeader");
  const footer = homeShell.page.sections.find((s) => s.type === "SiteFooter");

  const homePage: TemplateShellPage = {
    ...homeShell.page,
    sections: homeShell.page.sections.filter(
      (s) => s.type !== "SiteHeader" && s.type !== "SiteFooter",
    ),
  };

  const secondaryPages = data.navLinks
    .filter(
      (link) =>
        !link.href.startsWith("http") &&
        !link.href.startsWith("#") &&
        link.href !== "/",
    )
    .map((link) => inferSecondaryPage(link, data));

  return {
    site_metadata: {
      framework: "astro",
      mode: "replication",
      target_url: data.url,
      business_name: data.businessName,
      generated_at: new Date().toISOString(),
    },
    design_tokens: tokens,
    global_shell: {
      theme: tokens,
      header,
      footer,
      navLinks: data.navLinks,
    },
    pages: [homePage, ...secondaryPages],
  };
}
