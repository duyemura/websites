import { describe, it, expect } from "vitest";
import { loadPage, gym, builtCss } from "./helpers";

describe("layout skeleton", () => {
  it("homepage renders with gym name in title and exact hero headline", () => {
    const $ = loadPage("index.html");
    expect($("title").text()).toContain(gym.business.name);
    // Target by data-testid so future header/nav h1s don't silently pass this assertion
    expect($("[data-testid='hero-headline']").text().trim()).toBe(gym.pages.home.hero.headline);
  });

  it("brand tokens are emitted as CSS custom properties", () => {
    const $ = loadPage("index.html");
    const css = $("style").text();
    expect(css).toContain(`--color-primary: ${gym.brand.primaryColor}`);
    expect(css).toContain(`--font-heading:`);
  });

  it("sr-only class is present in built CSS (AEO entity anchor must be off-screen, not missing)", () => {
    // If Tailwind drops sr-only from the bundle, the AEO paragraph becomes visible body text
    expect(builtCss()).toMatch(/\.sr-only\s*\{/);
  });
});
