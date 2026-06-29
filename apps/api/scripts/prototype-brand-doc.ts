import { chromium, type Browser } from "playwright";
import { generateBrandGuidelines } from "../src/utils/brand-guidelines";
import { buildBrandGuidelinesInput } from "../src/utils/scrape-docs";
import { scrapeWebsite } from "../src/utils/scrape-website";
import { generateSiteDocs } from "../src/utils/site-docs";

const url = process.argv[2] ?? "https://www.crossfit.com";

async function main() {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const data = await scrapeWebsite(browser, { url, takeScreenshot: true });
    const brandInput = buildBrandGuidelinesInput(data);

    console.log("=== SCRAPED META ===");
    console.log(`URL: ${data.url}`);
    console.log(`Business: ${data.businessName}`);
    console.log(`Tagline: ${data.tagline}`);
    console.log(`Colors: ${data.colors.map((c) => `${c.token}=${c.hex}`).join(", ")}`);
    console.log(`Fonts: ${data.fonts.map((f) => `${f.family} (${f.role})`).join(", ")}`);
    console.log(`Design tokens: ${data.designTokens?.map((t) => `${t.category}=${t.value}`).join(", ")}`);
    console.log(`Screenshot: ${data.screenshotUrls?.[0] ?? "none"}`);
    console.log();

    console.log("=== BRAND GUIDELINES ===\n");
    console.log(generateBrandGuidelines(brandInput));

    console.log("\n=== ALL GENERATED SITE DOCS ===\n");
    for (const doc of generateSiteDocs(data)) {
      console.log(`--- ${doc.title} (${doc.key}) ---`);
      console.log(doc.content.slice(0, 500) + (doc.content.length > 500 ? "…" : ""));
      console.log();
    }
  } finally {
    await browser?.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
