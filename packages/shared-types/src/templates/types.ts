/**
 * Core template registry types.
 *
 * These types are imported by individual template specs and by the registry
 * index. Keeping them in a separate file avoids circular imports between specs
 * and the registry.
 */

export type ComponentPropSource =
  | { kind: "slot"; section: string; slot: string }
  /** Absolute path on GymSiteContent, e.g. "business.primaryCta.label". */
  | { kind: "field"; path: string }
  /** Relative path on the current page object, e.g. "hero" resolves to pages.{pageKey}.hero. */
  | { kind: "pageField"; path: string }
  | { kind: "computed"; fn: "programs" | "testimonials" | "faq" | "features" | "valueProps" | "howItWorks" | "serviceArea" };

export interface SlotSpec {
  purpose: string;
  type: "string" | "number" | "boolean" | "string[]" | "object";
  required?: boolean;
  maxWords?: number;
  guidance: string;
  example: string;
}

export interface SectionSpec {
  purpose: string;
  count?: number;          // for array sections: how many items
  slots: Record<string, SlotSpec>;
}

export interface ComponentPropSpec extends SlotSpec {
  /** Where the renderer should pull this prop from when assembling a page. */
  source?: ComponentPropSource;
}

export interface ComponentSpec {
  /**
   * Astro component filename under the template's sections folder,
   * without extension. The renderer resolves it as:
   *   sections/{template}/{component}.astro
   */
  component: string;
  purpose: string;
  /** When true, the renderer/fidelity may skip this component if its required data is missing. */
  conditional?: boolean;
  props: Record<string, ComponentPropSpec>;
}

export type PageArchetype =
  | "home"
  | "program"
  | "programIndex"
  | "about"
  | "contact"
  | "schedule"
  | "pricing"
  | "blogIndex"
  | "blogPost"
  | "content"
  | "team"
  | "form";

export interface PageSpec {
  /** Canonical path ("/" for home, "/about", etc.). */
  path: string;
  /** Logical page archetype. Future pages choose an existing archetype instead of inventing a layout. */
  archetype: PageArchetype;
  /** Component IDs in render order. */
  components: string[];
  /** What this page must accomplish for the visitor and the business. Used in LLM prompts and QA. */
  goal?: string;
  /** The single action the page should drive (e.g. "Book a free intro"). Used in CTAs and copy. */
  idealAction?: string;
  /** Where the visitor is in the decision journey. */
  visitorStage?: "awareness" | "consideration" | "conversion" | "retention";
  /** The search intent this page should satisfy. */
  searchIntent?: "informational" | "transactional" | "navigational" | "local";
  /** Objections or anxieties this page must address with proof. */
  objectionsToOvercome?: string[];
  /** Trust assets or proof points this page should display. */
  evidenceTypes?: string[];
  /** Primary search query this page is optimized for. */
  seoPrimaryQuery?: string;
  /** List of facts, themes, or assets the content generator should extract or synthesize for this page. */
  contentSignals?: string[];
  /** Paths into GymSiteContent that must be present and non-placeholder for publish to be allowed. */
  requiredFields?: string[];
  /** Whether a publish may proceed while placeholders remain on this page. */
  placeholderPolicy?: "allow" | "block-publish";
  /** Optional page-level chrome overrides. */
  slots?: {
    /** Extra components rendered inside <head> (e.g. schema markup). */
    head?: string[];
    /** Components rendered before the main page sections. */
    before?: string[];
    /** Components rendered after the main page sections. */
    after?: string[];
  };
}

export interface HeadAsset {
  /** HTML element tag name, e.g. "link" or "script". */
  tag: "link" | "script" | "style";
  /** Attributes to place on the element. For inline styles/scripts, use innerHtml. */
  attrs?: Record<string, string>;
  /** Inline content for <style> or <script> tags. */
  innerHtml?: string;
  /** Set true if this asset should be preloaded as a font. */
  preloadFont?: {
    href: string;
    type: string;
    crossorigin?: string;
  };
}

export interface TemplateSpec {
  name: string;
  description: string;
  /** Content sections the generate stage should fill. */
  sections: Record<string, SectionSpec>;
  /** Per-page-type content generation specs. Key is a page key (e.g. "program"). */
  pageSections?: Record<string, Record<string, SectionSpec>>;
  /** Reusable Astro components this template provides. */
  components: Record<string, ComponentSpec>;
  /** Page layouts defined as ordered component sequences. */
  pages: Record<string, PageSpec>;
  /** Extra <head> assets required by this template (stylesheets, fonts, scripts). */
  headAssets?: HeadAsset[];
  /** CSS classes to apply to <body> for this template. */
  bodyClasses?: string[];
}

export type TemplateTheme = "baseline" | "impact" | "beanburito";

export const TEMPLATE_THEMES: TemplateTheme[] = ["baseline", "impact", "beanburito"];
