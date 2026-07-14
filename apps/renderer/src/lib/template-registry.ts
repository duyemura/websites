// apps/renderer/src/lib/template-registry.ts
// Theme-agnostic registry of machine-readable TemplateSpec objects.
// New templates add their spec here instead of editing page files.
// Astro components are registered separately because TypeScript cannot resolve
// .astro imports from plain .ts files.

import { beanburitoSpec, type TemplateSpec } from "@milo/shared-types";

export const SPEC_REGISTRY: Record<string, TemplateSpec> = {
  beanburito: beanburitoSpec,
};

/** Look up a registered template spec by its canonical name. */
export function getRegisteredSpec(theme: string): TemplateSpec | undefined {
  return SPEC_REGISTRY[theme];
}
