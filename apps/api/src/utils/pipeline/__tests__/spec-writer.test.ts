import { describe, it, expect } from "vitest";
import { generateTemplateSpecSource } from "../spec-writer";
import type { ComponentGroup } from "../section-grouper";

const groups: ComponentGroup[] = [
  { name: "HeroLeft", tag: "hero", archetype: "hero-left", exemplar: { page: "/", contract: {} as any, cropDesktop: "", cropMobile: "", area: 0 }, occurrences: 1 },
  { name: "CtaBand", tag: "cta-band", archetype: "cta-band", exemplar: { page: "/", contract: {} as any, cropDesktop: "", cropMobile: "", area: 0 }, occurrences: 2 },
];

const pageMap: Record<string, string[]> = {
  "/": ["HeroLeft", "CtaBand"],
  "/about": ["HeroLeft", "CtaBand"],
};

describe("generateTemplateSpecSource", () => {
  it("exports a named const matching the template name", () => {
    const src = generateTemplateSpecSource("mygym", groups, pageMap);
    expect(src).toContain("export const mygymSpec");
    expect(src).toContain('name: "mygym"');
  });
  it("includes all component entries", () => {
    const src = generateTemplateSpecSource("mygym", groups, pageMap);
    expect(src).toContain('"HeroLeft"');
    expect(src).toContain('"CtaBand"');
  });
  it("imports TemplateSpec from the types file", () => {
    const src = generateTemplateSpecSource("mygym", groups, pageMap);
    expect(src).toContain("import type { TemplateSpec }");
  });
  it("generates balanced braces", () => {
    const src = generateTemplateSpecSource("mygym", groups, pageMap);
    expect((src.match(/\{/g) ?? []).length).toBe((src.match(/\}/g) ?? []).length);
  });
});
