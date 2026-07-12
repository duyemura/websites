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
  props: Record<string, ComponentPropSpec>;
}

export interface PageSpec {
  /** Canonical path ("/" for home, "/about", etc.). */
  path: string;
  /** Component IDs in render order. */
  components: string[];
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

export interface TemplateSpec {
  name: string;
  description: string;
  /** Content sections the generate stage should fill. */
  sections: Record<string, SectionSpec>;
  /** Reusable Astro components this template provides. */
  components: Record<string, ComponentSpec>;
  /** Page layouts defined as ordered component sequences. */
  pages: Record<string, PageSpec>;
}

export type TemplateTheme = "baseline" | "impact" | "beanburito";

export const TEMPLATE_THEMES: TemplateTheme[] = ["baseline", "impact", "beanburito"];
