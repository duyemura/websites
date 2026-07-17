// apps/renderer/src/lib/template-registry.ts
// Theme-agnostic registry of machine-readable TemplateSpec objects.
// New templates only need to register their spec in packages/shared-types; this
// file rebuilds the renderer-side registry from the shared-types exports.

import { getTemplateSpec, TEMPLATE_THEMES, type TemplateSpec } from "@milo/shared-types";

export const SPEC_REGISTRY: Record<string, TemplateSpec> = Object.fromEntries(
  TEMPLATE_THEMES
    .map((theme) => [theme, getTemplateSpec(theme)] as const)
    .filter(([, spec]) => spec !== null),
);

/** Look up a registered template spec by its canonical name. */
export function getRegisteredSpec(theme: string): TemplateSpec | undefined {
  return SPEC_REGISTRY[theme];
}
