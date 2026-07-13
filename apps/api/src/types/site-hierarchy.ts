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
  | "schedule"
  | "team"
  | "contact"
  | "iframe"
  | "unknown";

export interface SectionStyleHint {
  theme?: "dark" | "light";
  centered?: boolean;
  columns?: number;
  imagePosition?: "left" | "right" | "background" | "none";
  sourceOrder?: number;
  align?: "left" | "center" | "right";
  eyebrow?: string;
  uppercase?: boolean;
  ctaStyle?: "primary" | "dark" | "outline";
  heroTextColor?: string;
  heroCtaBg?: string;
  heroCtaColor?: string;
  heroCtaRadius?: string;
  heroCtaHasIcon?: boolean;
  heroCtaUppercase?: boolean;
  heroCtaBold?: boolean;
  heroCtaTransform?: string;
  heroCtaPadding?: string;
  subtitleUppercase?: boolean;
  eyebrowBg?: string;
  eyebrowColor?: string;
  eyebrowPadding?: string;
}

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
    /** Source iframe/widget src URL when this section represents an embedded third-party widget. */
    widgetUrl?: string;
  };
  styleHint?: SectionStyleHint;
  evidenceId: string;
  notes?: string;
  /** ID of the shared component this section maps to (from segment artifact). */
  sharedComponentId?: string;
  /** Prop overrides when this section renders a shared component. */
  sharedProps?: Record<string, string>;
}

export interface HierarchyPage {
  slug: string;
  /** Original URL path (e.g. "/programs/kids") — preserved for exact path matching in verify. */
  path?: string;
  isHomePage: boolean;
  title: string;
  metaTitle?: string;
  metaDescription?: string;
  primaryCta?: { label: string; href: string };
  sections: HierarchySection[];
  /** Background image URL for this page's hero section (re-hosted to our CDN). */
  heroImageUrl?: string;
  /** Whether this page has been segmented — false means only a stub redirect exists. */
  segmented?: boolean;
  /** Page type inferred from URL/content — used to select appropriate layout. */
  pageType?: "home" | "interior" | "contact" | "blog" | "schedule" | "unknown";
}

import type { SiteDocMetadata } from "./site-doc-metadata";

export interface SiteHierarchy {
  version: "1";
  siteMetadata: SiteDocMetadata;
  pages: HierarchyPage[];
  buildPlan: {
    nextPage: string;
    pageStatus: Record<string, PageBuildStatus>;
    buildOrder: string[];
  };
}
