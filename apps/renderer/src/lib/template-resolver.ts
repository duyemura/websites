// apps/renderer/src/lib/template-resolver.ts
// Registry-driven prop resolution for the renderer.
//
// This file resolves the machine-readable TemplateSpec (from
// @milo/shared-types) into concrete prop objects for Astro components.
// It does NOT import Astro components — those are statically imported by the
// PageRenderer so Astro can compile them.

import type {
  GymSiteContent,
  ValueProp,
  Feature,
  Step,
  Testimonial,
  FAQItem,
} from "../types/gym-content";
import type {
  TemplateSpec,
  ComponentPropSpec,
  ComponentPropSource,
} from "@milo/shared-types";

export type AstroComponent = (props: Record<string, unknown>) => unknown;

export interface ResolvedComponent {
  component: AstroComponent;
  props: Record<string, unknown>;
  componentId: string;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function getPageData(
  content: GymSiteContent,
  pageKey: string,
): Record<string, unknown> | undefined {
  const pages = content.pages as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >;
  return pages[pageKey] ?? undefined;
}

function resolveSlot(
  section: string,
  _slot: string,
  content: GymSiteContent,
  pageData: Record<string, unknown> | undefined,
): unknown {
  // Slots in the beanburito spec map to single-value fields on the page (or home).
  // Examples: communityHeadline, trustHeadline, howItWorksHeadline.
  if (pageData && typeof pageData[section] === "string") return pageData[section];
  const home = content.pages.home as unknown as Record<string, unknown>;
  if (typeof home[section] === "string") return home[section];
  return undefined;
}

function resolveComputed(
  fn: Extract<ComponentPropSource, { kind: "computed" }>["fn"],
  content: GymSiteContent,
  pageData: Record<string, unknown> | undefined,
): unknown {
  switch (fn) {
    case "valueProps":
      return (pageData?.valueProps as ValueProp[]) ?? content.pages.home.valueProps;
    case "features":
      return (pageData?.features as Feature[]) ?? content.pages.home.features;
    case "howItWorks":
      return (pageData?.howItWorks as Step[]) ?? content.pages.home.howItWorks;
    case "testimonials":
      return (pageData?.testimonials as Testimonial[]) ?? content.pages.home.testimonials;
    case "faq":
      return (pageData?.faq as FAQItem[]) ?? content.pages.home.faq;
    case "programs": {
      // Return full program objects for the current page's featuredPrograms (or home's).
      const slugs =
        (pageData?.featuredPrograms as string[]) ?? content.pages.home.featuredPrograms;
      return slugs
        .map((slug) => content.pages.programs.find((p) => p.slug === slug))
        .filter(Boolean);
    }
    case "serviceArea":
      return content.business.serviceArea;
    default:
      return undefined;
  }
}

function resolvePropValue(
  propName: string,
  propSpec: ComponentPropSpec,
  _componentId: string,
  content: GymSiteContent,
  pageData: Record<string, unknown> | undefined,
): unknown {
  const source = propSpec.source;
  if (!source) return undefined;

  switch (source.kind) {
    case "field": {
      return getPath(content as unknown as Record<string, unknown>, source.path);
    }
    case "pageField": {
      const value = pageData ? getPath(pageData, source.path) : undefined;
      if (value !== undefined && value !== null && value !== "") return value;
      // Fallback to the home page for shared sections (testimonials, faq, community, etc.).
      const home = content.pages.home as unknown as Record<string, unknown>;
      const homeValue = getPath(home, source.path);
      if (homeValue !== undefined && homeValue !== null && homeValue !== "") return homeValue;
      return undefined;
    }
    case "slot":
      return resolveSlot(source.section, source.slot, content, pageData);
    case "computed":
      return resolveComputed(source.fn, content, pageData);
    default:
      return undefined;
  }
}

function applyComponentDefaults(
  componentId: string,
  props: Record<string, unknown>,
  content: GymSiteContent,
): Record<string, unknown> {
  // Beanburito-specific defaults that keep the existing home-page behavior intact
  // until the content generator can populate these values itself.
  if (componentId === "valueProps") {
    return { ...props, sectionId: "valueProps" };
  }
  if (componentId === "amenities") {
    return {
      ...props,
      headline: props.headline ?? "Everything you need to crush your fitness goals",
    };
  }
  if (componentId === "community") {
    return { ...props, imageUrl: props.imageUrl ?? "/assets/beanburito/community.webp" };
  }
  if (componentId === "ctaBand") {
    const trust = (content.pages.home as unknown as Record<string, unknown>).trustHeadline as string | undefined;
    return {
      ...props,
      headline: props.headline ?? trust ?? "Ready to see what we are about?",
      ctaLabel: props.ctaLabel ?? content.business.primaryCta.label,
      ctaUrl: props.ctaUrl ?? content.business.primaryCta.url,
    };
  }
  // Beanburito is a dark template; shared section components that were built
  // for a light background need an explicit dark variant so text remains visible.
  if (componentId === "team" && content.meta.templateTheme === "beanburito") {
    return { ...props, variant: props.variant ?? "dark" };
  }
  return props;
}

export function resolvePageComponents(
  spec: TemplateSpec,
  pageKey: string,
  content: GymSiteContent,
  componentMap: Record<string, AstroComponent>,
  pageData?: Record<string, unknown>,
): ResolvedComponent[] {
  const page = spec.pages[pageKey];
  if (!page) return [];

  const effectivePageData = pageData ?? getPageData(content, pageKey);
  const resolved: ResolvedComponent[] = [];

  for (const componentId of page.components) {
    const componentSpec = spec.components[componentId];
    if (!componentSpec) continue;

    const Component = componentMap[componentId];
    if (!Component) continue;

    const props: Record<string, unknown> = {};
    for (const [propName, propSpec] of Object.entries(componentSpec.props)) {
      props[propName] = resolvePropValue(propName, propSpec, componentId, content, effectivePageData);
    }

    const finalProps = applyComponentDefaults(componentId, props, content);

    // Skip sections whose required props are missing and which have no sensible default.
    let shouldRender = true;
    for (const [propName, propSpec] of Object.entries(componentSpec.props)) {
      if (propSpec.required) {
        const value = finalProps[propName];
        if (
          value === undefined ||
          value === null ||
          (Array.isArray(value) && value.length === 0)
        ) {
          shouldRender = false;
          break;
        }
      }
    }
    if (!shouldRender) continue;

    resolved.push({ componentId, component: Component, props: finalProps });
  }

  return resolved;
}
