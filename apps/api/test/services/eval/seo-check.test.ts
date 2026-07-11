import { describe, test, expect } from "vitest";
import { checkSeo } from "../../../src/services/eval/checks/seo.js";

function mockPage(html: string) {
  return {
    content: () => Promise.resolve(html),
  } as unknown as import("playwright").Page;
}

describe("checkSeo", () => {
  test("passes a well-formed page", async () => {
    const html = `
      <html>
        <head>
          <title>CrossFit Denver | Best Gym in Denver, Colorado</title>
          <meta name="description" content="Join the best CrossFit gym in Denver, Colorado. Personalized coaching and community.">
          <link rel="canonical" href="https://example.com/">
          <meta property="og:title" content="CrossFit Denver">
          <script type="application/ld+json">{"@type":"LocalBusiness","name":"CrossFit Denver"}</script>
        </head>
        <body>
          <h1>Welcome to CrossFit Denver</h1>
          <h2>Programs</h2>
          <h3>CrossFit</h3>
          <img src="/logo.png" alt="CrossFit Denver logo">
        </body>
      </html>
    `;
    const category = await checkSeo({ page: mockPage(html) } as unknown as import("../../../src/services/eval/checks/check-context").CheckContext);
    expect(category.status).toBe("passed");
    expect(category.issues).toHaveLength(0);
  });

  test("flags missing title and meta description as critical/major", async () => {
    const html = `
      <html><body><h1>Welcome</h1></body></html>
    `;
    const category = await checkSeo({ page: mockPage(html) } as unknown as import("../../../src/services/eval/checks/check-context").CheckContext);
    expect(category.status).toBe("failed");
    expect(category.issues.some((i) => i.severity === "critical" && i.message.includes("title"))).toBe(true);
    expect(category.issues.some((i) => i.severity === "major" && i.message.includes("meta description"))).toBe(true);
  });

  test("flags missing alt text and JSON-LD", async () => {
    const html = `
      <html>
        <head><title>CrossFit Denver</title><meta name="description" content="A great gym in Denver, Colorado."></head>
        <body><h1>Welcome</h1><img src="/hero.png"></body>
      </html>
    `;
    const category = await checkSeo({ page: mockPage(html) } as unknown as import("../../../src/services/eval/checks/check-context").CheckContext);
    expect(category.issues.some((i) => i.message.includes("alt text"))).toBe(true);
    expect(category.issues.some((i) => i.message.includes("JSON-LD"))).toBe(true);
  });

  test("flags skipped heading levels", async () => {
    const html = `
      <html>
        <head><title>CrossFit Denver</title><meta name="description" content="A great gym in Denver, Colorado."></head>
        <body><h1>Welcome</h1><h3>Programs</h3></body>
      </html>
    `;
    const category = await checkSeo({ page: mockPage(html) } as unknown as import("../../../src/services/eval/checks/check-context").CheckContext);
    expect(category.issues.some((i) => i.message.includes("Skipped heading"))).toBe(true);
  });
});
