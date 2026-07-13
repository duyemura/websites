import { describe, test, expect } from "vitest";
import { getTemplateSpec, pageKeyByPath, pageComponents, componentSpec, TEMPLATE_THEMES } from "../registry.js";

describe("template registry", () => {
  test("TEMPLATE_THEMES includes supported themes", () => {
    expect(TEMPLATE_THEMES).toContain("baseline");
    expect(TEMPLATE_THEMES).toContain("impact");
    expect(TEMPLATE_THEMES).toContain("beanburito");
  });

  test("beanburito spec is registered", () => {
    const spec = getTemplateSpec("beanburito");
    expect(spec).not.toBeNull();
    expect(spec?.name).toBe("beanburito");
    expect(spec?.pages.home).toBeDefined();
    expect(spec?.pages.home.path).toBe("/");
  });

  test("baseline and impact specs are not yet registered", () => {
    expect(getTemplateSpec("baseline")).toBeNull();
    expect(getTemplateSpec("impact")).toBeNull();
  });

  test("pageKeyByPath resolves home and about", () => {
    const spec = getTemplateSpec("beanburito")!;
    expect(pageKeyByPath(spec, "/")).toBe("home");
    expect(pageKeyByPath(spec, "/about")).toBe("about");
    expect(pageKeyByPath(spec, "/missing")).toBeUndefined();
  });

  test("home page component list matches expected order", () => {
    const spec = getTemplateSpec("beanburito")!;
    expect(pageComponents(spec, "home")).toEqual([
      "hero",
      "valueProps",
      "programs",
      "howItWorks",
      "amenities",
      "community",
      "location",
      "testimonials",
      "iframeBand",
      "faq",
      "ctaBand",
    ]);
  });

  test("hero component is registered and uses pageField source", () => {
    const spec = getTemplateSpec("beanburito")!;
    const hero = componentSpec(spec, "hero");
    expect(hero).toBeDefined();
    expect(hero?.component).toBe("Hero");
    expect(hero?.props.hero?.source).toEqual({ kind: "pageField", path: "hero" });
  });
});
