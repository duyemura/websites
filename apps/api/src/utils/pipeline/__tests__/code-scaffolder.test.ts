import { describe, it, expect } from "vitest";
import { applyRegistryPatch, applyTypesPatch } from "../code-scaffolder";

// Fixture derived from actual content of packages/shared-types/src/templates/registry.ts
const REGISTRY_SRC = `/**
 * Template registry.
 */

import type { TemplateSpec, TemplateTheme } from "./types.js";
import { beanburitoSpec } from "./beanburito.js";
import { modernSpec } from "./modern.js";

export type {
  ComponentPropSource,
  TemplateSpec,
  TemplateTheme,
} from "./types.js";

export { TEMPLATE_THEMES } from "./types.js";

import type { ComponentSpec } from "./types.js";


const registry: Record<TemplateTheme, TemplateSpec | null> = {
  baseline: null,
  impact: null,
  beanburito: beanburitoSpec,
  modern: modernSpec,
};

/** Look up a template spec by theme. */
export function getTemplateSpec(theme: TemplateTheme): TemplateSpec | null {
  return registry[theme];
}
`;

// Fixture derived from actual content of packages/shared-types/src/templates/types.ts
const TYPES_SRC = `/**
 * Core template registry types.
 */

export type ComponentPropSource =
  | { kind: "slot"; section: string; slot: string }
  | { kind: "field"; path: string };

export interface SlotSpec {
  purpose: string;
  type: "string" | "number";
}

export type TemplateTheme = "baseline" | "impact" | "beanburito" | "modern";

export const TEMPLATE_THEMES: TemplateTheme[] = ["baseline", "impact", "beanburito", "modern"];
`;

describe("applyRegistryPatch", () => {
  it("adds import and registry entry for a new template name", () => {
    const result = applyRegistryPatch(REGISTRY_SRC, "mytheme");
    expect(result).toContain('import { mythemeSpec } from "./mytheme.js"');
    expect(result).toContain("mytheme: mythemeSpec,");
  });

  it("places the new import after the existing import block", () => {
    const result = applyRegistryPatch(REGISTRY_SRC, "mytheme");
    const importIdx = result.indexOf('import { mythemeSpec }');
    const registryIdx = result.indexOf("const registry");
    expect(importIdx).toBeGreaterThan(0);
    expect(importIdx).toBeLessThan(registryIdx);
  });

  it("places the new registry entry before the closing brace", () => {
    const result = applyRegistryPatch(REGISTRY_SRC, "mytheme");
    const entryIdx = result.indexOf("mytheme: mythemeSpec,");
    const closingIdx = result.indexOf("};", entryIdx);
    expect(closingIdx).toBeGreaterThan(entryIdx);
  });

  it("is idempotent — no-ops if name already present", () => {
    const once = applyRegistryPatch(REGISTRY_SRC, "mytheme");
    const twice = applyRegistryPatch(once, "mytheme");
    expect(twice).toBe(once);
  });

  it("throws if import block cannot be found", () => {
    expect(() => applyRegistryPatch("const x = 1;", "mytheme")).toThrow(
      "failed to find import block",
    );
  });

  it("throws if registry insertion point cannot be found", () => {
    // Source with imports but no trailing entry + closing brace pattern
    const noRegistry = `import type { TemplateSpec } from "./types.js";\n\nexport function foo() {}\n`;
    expect(() => applyRegistryPatch(noRegistry, "mytheme")).toThrow(
      "failed to find insertion point",
    );
  });

  it("does not duplicate an existing entry", () => {
    const once = applyRegistryPatch(REGISTRY_SRC, "mytheme");
    const count = (once.match(/mytheme: mythemeSpec,/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("applyTypesPatch", () => {
  it("adds name to TemplateTheme union", () => {
    const result = applyTypesPatch(TYPES_SRC, "mytheme");
    const unionIdx = result.indexOf("TemplateTheme =");
    const unionSlice = result.slice(unionIdx, unionIdx + 200);
    expect(unionSlice).toContain('"mytheme"');
  });

  it("adds name to TEMPLATE_THEMES array", () => {
    const result = applyTypesPatch(TYPES_SRC, "mytheme");
    const arrayIdx = result.indexOf("TEMPLATE_THEMES");
    const arraySlice = result.slice(arrayIdx, arrayIdx + 200);
    expect(arraySlice).toContain('"mytheme"');
  });

  it("preserves existing theme names in union", () => {
    const result = applyTypesPatch(TYPES_SRC, "mytheme");
    expect(result).toContain('"baseline"');
    expect(result).toContain('"beanburito"');
    expect(result).toContain('"modern"');
  });

  it("preserves existing theme names in array", () => {
    const result = applyTypesPatch(TYPES_SRC, "mytheme");
    const arrayIdx = result.indexOf("TEMPLATE_THEMES");
    const arraySlice = result.slice(arrayIdx, arrayIdx + 300);
    expect(arraySlice).toContain('"baseline"');
    expect(arraySlice).toContain('"beanburito"');
    expect(arraySlice).toContain('"modern"');
  });

  it("is idempotent — no-ops if name already present", () => {
    const once = applyTypesPatch(TYPES_SRC, "mytheme");
    const twice = applyTypesPatch(once, "mytheme");
    expect(twice).toBe(once);
  });

  it("throws if TemplateTheme union cannot be found", () => {
    expect(() => applyTypesPatch("const x = 1;", "mytheme")).toThrow(
      "failed to find TemplateTheme union",
    );
  });

  it("throws if TEMPLATE_THEMES array cannot be found", () => {
    // Has union but no array
    const noArray = `export type TemplateTheme = "baseline" | "impact";`;
    expect(() => applyTypesPatch(noArray, "mytheme")).toThrow(
      "failed to find TEMPLATE_THEMES array",
    );
  });

  it("does not duplicate an existing entry", () => {
    const once = applyTypesPatch(TYPES_SRC, "mytheme");
    const unionCount = (once.match(/"mytheme"/g) ?? []).length;
    // Should appear exactly twice: once in union, once in array
    expect(unionCount).toBe(2);
  });
});
