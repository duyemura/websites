import path from "node:path";
import {
  captureSectionCrop,
  computeSectionDiff,
  extractCardsFromSection,
  findSectionByHeading,
  launchBrowser,
  newDesktopContext,
  writeReport,
} from "../../src/utils/pipeline/section-diff";

const SOURCE_URL = "https://beanburito.github.io/free-intro-session-self-book-in-person/";
const RENDERED_URL = "http://localhost:4321/";
const OUT = path.resolve(import.meta.dirname, "./output/diff-beta-vs-impact");

async function run() {
  const browser = await launchBrowser();
  const context = await newDesktopContext(browser);

  // Source
  const sourcePage = await context.newPage();
  await sourcePage.goto(SOURCE_URL, { waitUntil: "load", timeout: 60000 });
  await sourcePage.waitForTimeout(2500);
  const sourceSection = await findSectionByHeading(sourcePage, "everything you need to crush");
  if (!sourceSection) {
    throw new Error("Could not find feature-grid section on source page");
  }
  await sourcePage.evaluate((y) => window.scrollTo(0, y), sourceSection.box.y);
  await sourcePage.waitForTimeout(300);
  const sourceData = await extractCardsFromSection(sourcePage, sourceSection.box, {
    excludeHeadingContains: sourceSection.heading,
  });
  console.log(
    "sourceData:",
    JSON.stringify(
      { bg: sourceData.backgroundColor, itemCount: sourceData.items.length, debug: sourceData.debug },
      null,
      2,
    ),
  );
  await captureSectionCrop(sourcePage, sourceSection.box, path.join(OUT, "source-feature-grid.png"));

  // Rendered
  const renderedPage = await context.newPage();
  await renderedPage.goto(RENDERED_URL, { waitUntil: "load", timeout: 60000 });
  await renderedPage.waitForTimeout(500);
  const renderedSection = await findSectionByHeading(renderedPage, "everything you need to crush");
  if (!renderedSection) {
    throw new Error("Could not find feature-grid section on rendered page");
  }
  await renderedPage.evaluate((y) => window.scrollTo(0, y), renderedSection.box.y);
  await renderedPage.waitForTimeout(300);
  const renderedData = await extractCardsFromSection(renderedPage, renderedSection.box, {
    excludeHeadingContains: renderedSection.heading,
  });
  console.log(
    "renderedData:",
    JSON.stringify(
      { bg: renderedData.backgroundColor, itemCount: renderedData.items.length, debug: renderedData.debug },
      null,
      2,
    ),
  );
  await captureSectionCrop(renderedPage, renderedSection.box, path.join(OUT, "rendered-feature-grid.png"));

  await browser.close();

  const report = computeSectionDiff(
    sourceSection.heading,
    renderedSection.heading,
    sourceSection.box,
    renderedSection.box,
    sourceData,
    renderedData,
  );
  report.sourceUrl = SOURCE_URL;
  report.renderedUrl = RENDERED_URL;

  const out = await writeReport(OUT, report);
  console.log(`Section diff complete. Output: ${out}`);
  console.log(JSON.stringify(report.diffs, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
