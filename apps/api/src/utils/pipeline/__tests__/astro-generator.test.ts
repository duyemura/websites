import { describe, it, expect, vi } from "vitest";
import { generateAstroComponent, buildAstroPromptText } from "../astro-generator";
import type { ComponentGroup } from "../section-grouper";

const mockGroup: ComponentGroup = {
  name: "HeroLeft",
  tag: "hero",
  archetype: "hero-left",
  exemplar: {
    page: "/",
    contract: { tag: "hero", layout: { archetype: "hero-left" }, background: { color: "#000" }, spacing: { top: "80px", bottom: "80px" }, typography: { headline: { text: "Join us", size: "64px", weight: "800", color: "#fff", align: "left" } }, interactions: { accordion: false, scrollSnap: false, stickyPanel: false, hoverEffects: false }, items: [] } as any,
    cropDesktop: "s3://desktop",
    cropMobile: "s3://mobile",
    area: 864000,
  },
  occurrences: 1,
};

describe("buildAstroPromptText", () => {
  it("includes tag, archetype, and component name", () => {
    const text = buildAstroPromptText(mockGroup, "");
    expect(text).toContain("hero-left");
    expect(text).toContain("HeroLeft");
    expect(text).toContain("hero");
  });
  it("includes contract JSON", () => {
    const text = buildAstroPromptText(mockGroup, "");
    expect(text).toContain('"#000"');
  });
});

describe("generateAstroComponent", () => {
  it("calls chatFn and returns trimmed response", async () => {
    const chatFn = vi.fn().mockResolvedValue("  ---\nconst x = 1\n---\n<div/>  ");
    const code = await generateAstroComponent(mockGroup, "", chatFn);
    expect(chatFn).toHaveBeenCalledOnce();
    expect(code).toBe("---\nconst x = 1\n---\n<div/>");
  });
});
