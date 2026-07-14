import { describe, test, expect } from "vitest";
import { buildSitePlaybook, buildConversionBrief } from "../generate-content.js";
import { beanburitoSpec } from "@milo/shared-types";

describe("buildSitePlaybook", () => {
  test("extracts an existing site playbook section from site-strategy", () => {
    const strategy = `# Site strategy\n\n## Site playbook\n\n### Conversion goal\n\n- Drive bookings.\n\n### Ideal first action\n\n- Book a free intro.\n\n## Verified source facts\n\n- Source website: https://example.com`;
    const result = buildSitePlaybook(strategy, "", "");
    expect(result).toContain("### Conversion goal");
    expect(result).toContain("Drive bookings");
    expect(result).not.toContain("Verified source facts");
  });

  test("derives a fallback playbook from workspace memory and business info", () => {
    const workspaceMemory = `# Workspace memory\n\n### Brand voice\n\n- Direct, no fluff, coach-to-athlete.\n`;
    const businessInfo = `**Primary CTA**: Start free trial\n**Offer**: 7-day free trial\n**How to sign up**: Fill out the contact form`;
    const result = buildSitePlaybook("no playbook here", workspaceMemory, businessInfo);
    expect(result).toContain("## Site playbook");
    expect(result).toContain("Direct, no fluff, coach-to-athlete");
    expect(result).toContain("Primary CTA: Start free trial");
    expect(result).toContain("Offer: 7-day free trial");
    expect(result).toContain("How to sign up: Fill out the contact form");
  });

  test("returns a minimal playbook when no sources are available", () => {
    const result = buildSitePlaybook("", "", "");
    expect(result).toContain("## Site playbook");
    expect(result).toContain("Book a free intro or tour");
  });
});

describe("buildConversionBrief", () => {
  test("renders all conversion brief fields", () => {
    const brief = buildConversionBrief(beanburitoSpec.pages.home);
    expect(brief).toContain("PAGE GOAL:");
    expect(brief).toContain("IDEAL ACTION:");
    expect(brief).toContain("VISITOR STAGE: awareness");
    expect(brief).toContain("SEARCH INTENT: local");
    expect(brief).toContain("OBJECTIONS TO OVERCOME:");
    expect(brief).toContain("EVIDENCE TO USE:");
    expect(brief).toContain("SEO PRIMARY QUERY:");
  });

  test("omits empty fields", () => {
    const brief = buildConversionBrief({ path: "/test", archetype: "test", components: [] });
    expect(brief).toBe("");
  });

  test("about page brief emphasizes trust", () => {
    const brief = buildConversionBrief(beanburitoSpec.pages.about);
    expect(brief).toContain("Earn trust");
    expect(brief).toContain("founder story");
    expect(brief).toContain("about [gym name] in [city]");
  });
});
