export type PageBuildStatus =
  | "planned"
  | "in_progress"
  | "built"
  | "approved"
  | "skipped";

export type CanonicalSectionTag =
  | "hero"
  | "header"
  | "footer"
  | "cta-band"
  | "content-block"
  | "media-block"
  | "feature-grid"
  | "testimonial-band"
  | "location-block"
  | "faq-block"
  | "social-proof-band"
  | "steps-band"
  | "unknown";

export interface HierarchySection {
  id: string;
  tag: CanonicalSectionTag;
  intent: string;
  content: {
    heading?: string;
    body?: string;
    eyebrow?: string;
    items?: { title?: string; description?: string; imageUrl?: string }[];
    images?: { url: string; alt?: string; context?: string }[];
    cta?: { label: string; href: string };
  };
  evidenceId: string;
  notes?: string;
}

export interface HierarchyPage {
  slug: string;
  isHomePage: boolean;
  title: string;
  metaTitle?: string;
  metaDescription?: string;
  primaryCta?: { label: string; href: string };
  sections: HierarchySection[];
}

export interface SiteHierarchy {
  version: "1";
  siteMetadata: {
    framework: "astro";
    mode: "replication" | "template" | "greenfield";
    targetUrl?: string;
    businessName?: string;
    generatedAt: string;
  };
  pages: HierarchyPage[];
  buildPlan: {
    nextPage: string;
    pageStatus: Record<string, PageBuildStatus>;
    buildOrder: string[];
  };
}
