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
  it("fills in canonical pages missing from the reference site", () => {
    const src = generateTemplateSpecSource("mygym", groups, { "/": ["HeroLeft", "CtaBand"] });
    expect(src).toContain('"home":');
    expect(src).toContain('"about":');
    expect(src).toContain('"contact":');
    expect(src).toContain('"pricing":');
    expect(src).toContain('"schedule":');
    expect(src).toContain('"programIndex":');
    expect(src).toContain('"program":');
    expect(src).toContain('"blog":');
    expect(src).toContain('"legal":');
    expect(src).toContain('path: "/programs/:slug"');
    expect(src).toContain('archetype: "programIndex"');
    expect(src).toContain('archetype: "blogIndex"');
  });

  describe("prop inference", () => {
    it("hero components get headline and backgroundImageUrl props", () => {
      const heroGroup: ComponentGroup[] = [
        { name: "HeroLeft", tag: "hero", archetype: "hero-left", exemplar: { page: "/", contract: {} as any, cropDesktop: "", cropMobile: "", area: 0 }, occurrences: 1 },
      ];
      const src = generateTemplateSpecSource("mygym", heroGroup, {});
      expect(src).toContain('"headline"');
      expect(src).toContain('"backgroundImageUrl"');
      expect(src).toContain('"ctaText"');
      expect(src).toContain('"ctaHref"');
    });

    it("cta components get ctaText and ctaHref props", () => {
      const ctaGroup: ComponentGroup[] = [
        { name: "CtaBand", tag: "cta-band", archetype: "cta-band", exemplar: { page: "/", contract: {} as any, cropDesktop: "", cropMobile: "", area: 0 }, occurrences: 1 },
      ];
      const src = generateTemplateSpecSource("mygym", ctaGroup, {});
      expect(src).toContain('"ctaText"');
      expect(src).toContain('"ctaHref"');
    });

    it("unknown components get empty props block", () => {
      const unknownGroup: ComponentGroup[] = [
        { name: "SomethingCustom", tag: "custom", archetype: "custom", exemplar: { page: "/", contract: {} as any, cropDesktop: "", cropMobile: "", area: 0 }, occurrences: 1 },
      ];
      const src = generateTemplateSpecSource("mygym", unknownGroup, {});
      // Should have headline (not footer/header/nav) but no hero/cta/grid props
      expect(src).toContain('"headline"');
      expect(src).not.toContain('"backgroundImageUrl"');
      expect(src).not.toContain('"ctaText"');
      expect(src).not.toContain('"items"');
    });

    it("footer/header/nav components get empty props block (no headline)", () => {
      const navGroup: ComponentGroup[] = [
        { name: "NavBar", tag: "nav", archetype: "nav", exemplar: { page: "/", contract: {} as any, cropDesktop: "", cropMobile: "", area: 0 }, occurrences: 1 },
      ];
      const src = generateTemplateSpecSource("mygym", navGroup, {});
      expect(src).toContain("props: {}");
    });

    it("grid/card components get items prop", () => {
      const gridGroup: ComponentGroup[] = [
        { name: "IconCardGrid", tag: "card-grid", archetype: "card-grid", exemplar: { page: "/", contract: {} as any, cropDesktop: "", cropMobile: "", area: 0 }, occurrences: 1 },
      ];
      const src = generateTemplateSpecSource("mygym", gridGroup, {});
      expect(src).toContain('"items"');
    });
  });
});
