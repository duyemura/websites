/**
 * Template registry.
 *
 * This is the machine-readable contract between the API content generator,
 * the renderer build process, and the per-page QA evaluator. Every supported
 * template has a TemplateSpec that declares:
 *
 *   - Sections (content slots the LLM should fill)
 *   - Components (reusable Astro blocks and their prop schemas)
 *   - Pages (ordered component sequences for each canonical page)
 *
 * The renderer consumes the registry to assemble pages dynamically.
 * The evaluator consumes it to check rendered pages against the declared structure.
 */

import type { TemplateSpec, TemplateTheme } from "./types.js";
import { beanburitoSpec } from "./beanburito.js";

export type {
  ComponentPropSource,
  ComponentPropSpec,
  ComponentSpec,
  HeadAsset,
  PageSpec,
  SectionSpec,
  SlotSpec,
  TemplateSpec,
  TemplateTheme,
} from "./types.js";

export { TEMPLATE_THEMES } from "./types.js";

import type { ComponentSpec } from "./types.js";


const registry: Record<TemplateTheme, TemplateSpec | null> = {
  baseline: null,
  impact: null,
  beanburito: beanburitoSpec,
};

/** Look up a template spec by theme. */
export function getTemplateSpec(theme: TemplateTheme): TemplateSpec | null {
  return registry[theme];
}

/** List component IDs used by a given page. */
export function pageComponents(spec: TemplateSpec, pageKey: string): string[] {
  return spec.pages[pageKey]?.components ?? [];
}

/** Look up a component spec by ID. */
export function componentSpec(spec: TemplateSpec, componentId: string): ComponentSpec | undefined {
  return spec.components[componentId];
}

/** Resolve a page key from a canonical path. */
export function pageKeyByPath(spec: TemplateSpec, path: string): string | undefined {
  for (const [key, page] of Object.entries(spec.pages)) {
    if (page.path === path) return key;
  }
  return undefined;
}
