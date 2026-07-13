import { inferIndustry, type ScrapedWebsiteData } from "./scrape-docs";
import { DEFAULT_TEMPLATE_TOKENS } from "@milo/shared-types/template-baseline";
import type {
  TemplateShell,
  TemplateShellPlaceholder,
  SiteSection,
} from "@milo/shared-types";

function createPlaceholderGenerator() {
  let counter = 0;
  return {
    nextKey(): string {
      counter += 1;
      return `placeholder-${counter.toString().padStart(3, "0")}`;
    },
  };
}

type PlaceholderGenerator = ReturnType<typeof createPlaceholderGenerator>;

function makePlaceholder(
  label: string,
  sectionId: string,
  propPath: string,
  originalValue?: string,
): TemplateShellPlaceholder {
  return {
    key: "",
    label,
    sectionId,
    propPath,
    originalValue,
  };
}

function anonymizeNavLinks(
  links: { label: string; href: string }[],
  sectionId: string,
  placeholders: TemplateShellPlaceholder[],
  gen: PlaceholderGenerator,
): { label: string; href: string }[] {
  return links.map((link, index) => {
    const key = gen.nextKey();
    const label = `{{${key}: nav label}}`;
    placeholders.push({ ...makePlaceholder("Navigation label", sectionId, `navLinks[${index}].label`, link.label), key });
    return { label, href: link.href };
  });
}

function makeHeaderSection(
  navLinks: { label: string; href: string }[],
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const sectionId = "header-shell";
  const placeholders: TemplateShellPlaceholder[] = [];
  const logoKey = gen.nextKey();
  const ctaKey = gen.nextKey();
  placeholders.push({ ...makePlaceholder("Logo / business name", sectionId, "logo.value"), key: logoKey });
  placeholders.push({ ...makePlaceholder("Header CTA label", sectionId, "ctaLabel", "Join now"), key: ctaKey });
  return {
    section: {
      id: sectionId,
      type: "SiteHeader",
      props: {
        logo: { type: "text", value: `{{${logoKey}: business name}}` },
        navLinks: anonymizeNavLinks(navLinks.slice(0, 6), sectionId, placeholders, gen),
        ctaLabel: `{{${ctaKey}: header CTA}}`,
        ctaHref: "#cta",
      },
    },
    placeholders,
  };
}

function makeHeroSection(
  data: ScrapedWebsiteData,
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const sectionId = "hero-shell";
  const placeholders: TemplateShellPlaceholder[] = [];

  const headline = data.headings[0] ?? "Headline";
  const subheadline = data.paragraphs[0] ?? "Subheadline";
  const cta = data.buttons[0] ?? "Get started";

  const headlineKey = gen.nextKey();
  const subheadlineKey = gen.nextKey();
  const ctaKey = gen.nextKey();

  placeholders.push({ ...makePlaceholder("Hero headline", sectionId, "title", headline), key: headlineKey });
  placeholders.push({ ...makePlaceholder("Hero subheadline", sectionId, "subtitle", subheadline), key: subheadlineKey });
  placeholders.push({ ...makePlaceholder("Hero CTA label", sectionId, "cta.label", cta), key: ctaKey });

  return {
    section: {
      id: sectionId,
      type: "Hero",
      props: {
        title: `{{${headlineKey}: headline}}`,
        subtitle: `{{${subheadlineKey}: subheadline}}`,
        cta: { label: `{{${ctaKey}: CTA}}`, href: "#cta" },
        backgroundImage: null,
        layout: "center",
      },
    },
    placeholders,
  };
}

function makeTextSection(
  title: string,
  body: string,
  sectionId: string,
  labelPrefix: string,
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const placeholders: TemplateShellPlaceholder[] = [];
  const titleKey = gen.nextKey();
  const bodyKey = gen.nextKey();
  placeholders.push({ ...makePlaceholder(`${labelPrefix} title`, sectionId, "title", title), key: titleKey });
  placeholders.push({ ...makePlaceholder(`${labelPrefix} body`, sectionId, "body", body), key: bodyKey });
  return {
    section: {
      id: sectionId,
      type: "Text",
      props: {
        title: `{{${titleKey}: title}}`,
        body: `{{${bodyKey}: body}}`,
        align: "center",
      },
    },
    placeholders,
  };
}

function makeCardGroupSection(
  title: string,
  items: { title?: string; description?: string; price?: string }[],
  sectionId: string,
  labelPrefix: string,
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const placeholders: TemplateShellPlaceholder[] = [];
  const titleKey = gen.nextKey();
  placeholders.push({ ...makePlaceholder(`${labelPrefix} section title`, sectionId, "title", title), key: titleKey });

  const cards = items.slice(0, 6).map((item, index) => {
    const cardTitleKey = gen.nextKey();
    const cardBodyKey = gen.nextKey();
    const cardPriceKey = item.price ? gen.nextKey() : undefined;
    placeholders.push({ ...makePlaceholder(`${labelPrefix} card title`, sectionId, `cards[${index}].title`, item.title), key: cardTitleKey });
    placeholders.push({ ...makePlaceholder(`${labelPrefix} card description`, sectionId, `cards[${index}].description`, item.description), key: cardBodyKey });
    if (cardPriceKey && item.price) {
      placeholders.push({ ...makePlaceholder(`${labelPrefix} card price`, sectionId, `cards[${index}].price`, item.price), key: cardPriceKey });
    }
    return {
      title: `{{${cardTitleKey}: card title}}`,
      description: `{{${cardBodyKey}: card description}}`,
      price: cardPriceKey ? `{{${cardPriceKey}: price}}` : undefined,
    };
  });

  return {
    section: {
      id: sectionId,
      type: "SiteCardGroup",
      props: {
        title: `{{${titleKey}: section title}}`,
        layout: items.length >= 3 ? "grid" : "row",
        cards,
      },
    },
    placeholders,
  };
}

function makeReviewsSection(
  testimonials: { quote: string; author?: string; role?: string }[],
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const sectionId = "reviews-shell";
  const placeholders: TemplateShellPlaceholder[] = [];
  const titleKey = gen.nextKey();
  placeholders.push({ ...makePlaceholder("Reviews section title", sectionId, "title", "What members say"), key: titleKey });

  const reviews = testimonials.slice(0, 4).map((t, index) => {
    const quoteKey = gen.nextKey();
    const authorKey = gen.nextKey();
    placeholders.push({ ...makePlaceholder("Testimonial quote", sectionId, `reviews[${index}].quote`, t.quote), key: quoteKey });
    placeholders.push({ ...makePlaceholder("Testimonial author", sectionId, `reviews[${index}].author`, t.author), key: authorKey });
    return {
      quote: `{{${quoteKey}: testimonial}}`,
      author: `{{${authorKey}: author}}`,
    };
  });

  return {
    section: {
      id: sectionId,
      type: "SiteReviews",
      props: {
        title: `{{${titleKey}: what members say}}`,
        reviews,
      },
    },
    placeholders,
  };
}

function makeLocationSection(
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const sectionId = "location-shell";
  const placeholders: TemplateShellPlaceholder[] = [];

  const titleKey = gen.nextKey();
  const addressKey = gen.nextKey();
  const hoursKey = gen.nextKey();
  const phoneKey = gen.nextKey();
  placeholders.push({ ...makePlaceholder("Location section title", sectionId, "title", "Visit us"), key: titleKey });
  placeholders.push({ ...makePlaceholder("Location address", sectionId, "address"), key: addressKey });
  placeholders.push({ ...makePlaceholder("Location hours", sectionId, "hours"), key: hoursKey });
  placeholders.push({ ...makePlaceholder("Location phone", sectionId, "phone"), key: phoneKey });

  return {
    section: {
      id: sectionId,
      type: "SiteLocation",
      props: {
        title: `{{${titleKey}: visit us}}`,
        address: `{{${addressKey}: address}}`,
        hours: `{{${hoursKey}: hours}}`,
        phone: `{{${phoneKey}: phone}}`,
        mapLink: "#map",
      },
    },
    placeholders,
  };
}

function makeFooterSection(
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const sectionId = "footer-shell";
  const placeholders: TemplateShellPlaceholder[] = [];
  const businessKey = gen.nextKey();
  const year = new Date().getFullYear();
  placeholders.push({ ...makePlaceholder("Footer business name", sectionId, "businessName"), key: businessKey });
  return {
    section: {
      id: sectionId,
      type: "SiteFooter",
      props: {
        businessName: `{{${businessKey}: business name}}`,
        navLinks: [],
        socialLinks: [],
        copyright: `© ${year} {{${businessKey}: business name}}. All rights reserved.`,
      },
    },
    placeholders,
  };
}

function makeCtaSection(
  gen: PlaceholderGenerator,
): {
  section: SiteSection;
  placeholders: TemplateShellPlaceholder[];
} {
  const sectionId = "cta-shell";
  const placeholders: TemplateShellPlaceholder[] = [];
  const titleKey = gen.nextKey();
  const ctaKey = gen.nextKey();
  placeholders.push({ ...makePlaceholder("CTA title", sectionId, "title", "Ready to get started?"), key: titleKey });
  placeholders.push({ ...makePlaceholder("CTA button label", sectionId, "ctaLabel", "Book now"), key: ctaKey });
  return {
    section: {
      id: sectionId,
      type: "SiteBlock",
      props: {
        title: `{{${titleKey}: CTA title}}`,
        ctaLabel: `{{${ctaKey}: CTA label}}`,
        ctaHref: "#cta",
        background: "muted",
      },
    },
    placeholders,
  };
}

function buildSections(
  data: ScrapedWebsiteData,
  gen: PlaceholderGenerator,
): {
  sections: SiteSection[];
  placeholders: TemplateShellPlaceholder[];
} {
  const sections: SiteSection[] = [];
  const placeholders: TemplateShellPlaceholder[] = [];

  if (data.navLinks.length > 0) {
    const { section, placeholders: p } = makeHeaderSection(data.navLinks, gen);
    sections.push(section);
    placeholders.push(...p);
  }

  if (data.headings.length > 0 || data.paragraphs.length > 0) {
    const { section, placeholders: p } = makeHeroSection(data, gen);
    sections.push(section);
    placeholders.push(...p);
  }

  const aboutHeading = data.headings[1] ?? "About us";
  const aboutBody = data.paragraphs[1] ?? data.description ?? "";
  if (aboutBody.length > 20) {
    const { section, placeholders: p } = makeTextSection(aboutHeading, aboutBody, "about-shell", "About", gen);
    sections.push(section);
    placeholders.push(...p);
  }

  if (data.offerings.length > 0) {
    const { section, placeholders: p } = makeCardGroupSection(
      "What we offer",
      data.offerings,
      "offerings-shell",
      "Offering",
      gen,
    );
    sections.push(section);
    placeholders.push(...p);
  }

  if (data.team.length > 0) {
    const { section, placeholders: p } = makeCardGroupSection(
      "Meet the team",
      data.team.map((t) => ({ title: t.name, description: t.bio, price: t.role })),
      "team-shell",
      "Team",
      gen,
    );
    sections.push(section);
    placeholders.push(...p);
  }

  if (data.testimonials.length > 0) {
    const { section, placeholders: p } = makeReviewsSection(data.testimonials, gen);
    sections.push(section);
    placeholders.push(...p);
  }

  if (data.locations.length > 0 || data.contact?.phone) {
    const { section, placeholders: p } = makeLocationSection(gen);
    sections.push(section);
    placeholders.push(...p);
  }

  if (data.buttons.length > 0 || data.offerings.length > 0) {
    const { section, placeholders: p } = makeCtaSection(gen);
    sections.push(section);
    placeholders.push(...p);
  }

  const { section, placeholders: p } = makeFooterSection(gen);
  sections.push(section);
  placeholders.push(...p);

  return { sections, placeholders };
}

function buildMetaTitle(data: ScrapedWebsiteData): string {
  const base = data.title || "Website";
  return base.replace(data.businessName || "", "{{business_name}}").trim() || "{{page_title}}";
}

function sectionPurpose(section: SiteSection): string {
  switch (section.type) {
    case "SiteHeader":
      return "top navigation bar";
    case "Hero":
      return "homepage hero with headline, subheadline, and primary CTA";
    case "Text":
      return "text section for editorial or about content";
    case "SiteCardGroup":
      return "card grid for offerings, services, or team profiles";
    case "SiteReviews":
      return "social proof / testimonials section";
    case "SiteLocation":
      return "location and hours section";
    case "SiteBlock":
      return "call-to-action block";
    case "SiteFooter":
      return "footer with business name and links";
    default:
      return "content section";
  }
}

function generateInstructions(
  data: ScrapedWebsiteData,
  placeholders: TemplateShellPlaceholder[],
  sections: SiteSection[],
): string {
  const lines = [
    `# Template instructions: ${data.title || "Imported website"}`,
    "",
    `This template was generated from ${data.url} on ${new Date().toLocaleDateString()}.`,
    "It preserves the source site's structure, spacing, and section order, with all brand-specific copy, colors, and images replaced by placeholders.",
    "",
    "## Page structure",
    "",
  ];

  for (const [index, section] of sections.entries()) {
    lines.push(`${index + 1}. **${section.type}** (${section.id}) — ${sectionPurpose(section)}`);
  }

  lines.push(
    "",
    "## Placeholders to fill",
    "",
    "When building a site from this template, replace every `{{placeholder-###: label}}` token using the workspace docs and brand guidelines.",
    "",
  );

  for (const p of placeholders) {
    const original = p.originalValue ? ` (original: "${p.originalValue.slice(0, 80)}")` : "";
    lines.push(`- **${p.key}** — ${p.label}${original}`);
  }

  lines.push(
    "",
    "## Source signals",
    "",
    `- **Industry hint**: ${data.industry || inferIndustry(`${data.title ?? ""} ${data.description ?? ""}`)}`,
    `- **Detected headings**: ${data.headings.slice(0, 3).join(" / ") || "none"}`,
    `- **Detected offerings**: ${data.offerings.map((o) => o.name).slice(0, 3).join(" / ") || "none"}`,
    `- **Detected locations**: ${data.locations.map((l) => l.name).slice(0, 2).join(" / ") || "none"}`,
    "",
    "## AI guidance",
    "",
    "1. Read [[workspace-memory]] and [[brand-guidelines]] before generating any copy.",
    "2. Preserve the section order above; do not add or remove sections unless the user asks.",
    "3. Match the tone of the workspace brand, not the source website's brand.",
    "4. Replace every placeholder with real, specific copy from the gym's business info.",
    "5. Leave `{{placeholder-...}}` tokens in place if the required information is missing, and prompt the user to fill them.",
  );

  return lines.join("\n");
}

export function buildTemplateShell(data: ScrapedWebsiteData): TemplateShell {
  const gen = createPlaceholderGenerator();
  const { sections, placeholders } = buildSections(data, gen);

  return {
    source: {
      type: "url",
      url: data.url,
      scrapedAt: new Date().toISOString(),
    },
    theme: DEFAULT_TEMPLATE_TOKENS,
    page: {
      title: buildMetaTitle(data),
      slug: "index",
      isHomePage: true,
      metaTitle: buildMetaTitle(data),
      metaDescription: data.description
        ? data.description.replace(data.businessName || "", "{{business_name}}")
        : "{{meta_description}}",
      sections,
    },
    placeholders,
    instructions: generateInstructions(data, placeholders, sections),
  };
}
