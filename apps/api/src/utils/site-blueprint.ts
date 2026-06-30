import type { ScrapedWebsiteData } from "./scrape-docs";
import type {
  SiteSection,
  TemplateShellPage,
  ThemeTokens,
} from "@ploy-gyms/shared-types";

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
  const surface = data.colors.find((c) => c.role === "surface")?.hex;
  const textMuted = data.colors.find((c) => c.role === "textMuted")?.hex;
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
      muted: surface ?? NEUTRAL_TOKENS.colors.muted,
      mutedForeground: textMuted ?? NEUTRAL_TOKENS.colors.mutedForeground,
      border: border ?? NEUTRAL_TOKENS.colors.border,
    },
    fonts: {
      heading: headingFont ?? NEUTRAL_TOKENS.fonts.heading,
      body: bodyFont ?? NEUTRAL_TOKENS.fonts.body,
    },
    radius,
  };
}

export function deriveSlug(href: string, fallback: string): string {
  try {
    if (href.startsWith("/")) {
      const rawSlug = href.replace(/^\/+/, "").split("/")[0];
      const slug = rawSlug?.split(/[?#]/)[0];
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

function makeHeroSection(
  data: ScrapedWebsiteData,
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "Hero",
    props: {
      title: data.headings[0] ?? "",
      subtitle: data.paragraphs[0] ?? "",
      cta: { label: data.buttons[0] ?? "", href: "#cta" },
      backgroundImage: data.images.find((i) => i.context === "hero")?.url ?? null,
      layout: "center",
    },
  };
}

function makeHeaderSection(data: ScrapedWebsiteData): SiteSection {
  return {
    id: "header",
    type: "SiteHeader",
    props: {
      logo: { type: "text", value: data.businessName ?? data.title },
      navLinks: data.navLinks,
      ctaLabel: data.buttons[0] ?? "Contact",
      ctaHref: "#cta",
    },
  };
}

function makeFooterSection(data: ScrapedWebsiteData): SiteSection {
  const businessName = data.businessName ?? data.title;
  const year = new Date().getFullYear();
  return {
    id: "footer",
    type: "SiteFooter",
    props: {
      businessName,
      navLinks: data.navLinks,
      socialLinks: data.contact?.social ?? [],
      copyright: `© ${year} ${businessName}. All rights reserved.`,
    },
  };
}

function buildHomePage(data: ScrapedWebsiteData): TemplateShellPage {
  const sections: SiteSection[] = [];
  const sectionId = (prefix: string) => `home-${prefix}`;

  if (data.headings.length > 0 || data.paragraphs.length > 0) {
    sections.push(makeHeroSection(data, sectionId("hero")));
  }

  const aboutBody = data.description || data.paragraphs[1] || "";
  if (aboutBody.length > 20) {
    sections.push(makeTextSection("About us", aboutBody, sectionId("about")));
  }

  if (data.offerings.length > 0) {
    sections.push(
      makeCardGroupSection(
        "What we offer",
        data.offerings.map((o) => ({
          title: o.name,
          description: o.description,
        })),
        sectionId("offerings"),
      ),
    );
  }

  if (data.testimonials.length > 0) {
    sections.push(makeReviewsSection(data.testimonials, sectionId("reviews")));
  }

  if (data.locations.length > 0) {
    sections.push(
      makeLocationSection(
        data.locations,
        sectionId("location"),
        data.contact?.phone,
      ),
    );
  }

  return {
    slug: "index",
    isHomePage: true,
    title: data.title,
    metaTitle: data.title,
    metaDescription: data.description ?? "",
    sections,
  };
}

function makeLocationSection(
  locations: { name?: string; address?: string; hours?: string }[],
  sectionId: string,
  phone?: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteLocation",
    props: {
      title: "Visit us",
      address: locations
        .map((loc) => [loc.name, loc.address].filter(Boolean).join(" — "))
        .join("\n"),
      hours: locations[0]?.hours ?? "",
      phone: phone ?? "",
      mapLink: "#map",
    },
  };
}

function inferSecondaryPage(
  link: { label: string; href: string },
  data: ScrapedWebsiteData,
): TemplateShellPage | null {
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
        makeCardGroupSection(
          title,
          data.offerings.map((o) => ({
            title: o.name,
            description: o.description,
          })),
          sectionId("offerings"),
        ),
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
      sections.push(
        makeLocationSection(
          data.locations,
          sectionId("location"),
          data.contact?.phone,
        ),
      );
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
    const body = data.description ?? data.paragraphs[0] ?? "";
    if (body) {
      sections.push(makeTextSection(title, body, sectionId("content")));
    }
  }

  if (sections.length === 0) {
    return null;
  }

  return {
    slug,
    title,
    isHomePage: false,
    metaTitle: title,
    sections,
  };
}

function isInternalRelativeLink(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function buildSiteBlueprint(data: ScrapedWebsiteData): SiteBlueprint {
  const tokens = buildDesignTokens(data);
  const header = makeHeaderSection(data);
  const footer = makeFooterSection(data);

  const homePage = buildHomePage(data);

  const secondaryPages = data.navLinks
    .filter((link) => isInternalRelativeLink(link.href) && link.href !== "/")
    .map((link) => inferSecondaryPage(link, data))
    .filter((page): page is TemplateShellPage => page !== null);

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
