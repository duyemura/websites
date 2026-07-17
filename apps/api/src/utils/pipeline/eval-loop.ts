import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { visionDiff, type VisionIssue } from "./visual-diff";

const execAsync = promisify(exec);
const PASS_THRESHOLD = 85;
const MAX_ITERATIONS = 5;

export interface EvalLoopResult {
  componentName: string;
  finalScore: number;
  iterations: number;
  passed: boolean;
  remainingIssues: VisionIssue[];
}

export interface ComponentTarget {
  name: string;
  filePath: string; // absolute path to .astro file
  originalCropDesktop: string; // S3 URL of original section crop
  pagePath: string; // rendered page path containing this component (e.g. "/")
}

type ChatFn = (req: {
  messages: Array<{ role: "user"; content: unknown }>;
  maxTokens?: number;
}) => Promise<string>;

export async function runEvalLoop(
  target: ComponentTarget,
  rendererDir: string, // absolute path to apps/renderer
  loadImageFn: (url: string) => Promise<string>,
  chatFn: ChatFn,
): Promise<EvalLoopResult> {
  let score = 0;
  let issues: VisionIssue[] = [];
  let iterations = 0;

  const hybridLoadFn = (url: string): Promise<string> =>
    url.startsWith("data:") ? Promise.resolve(url) : loadImageFn(url);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i + 1;

    // 1. Build
    await execAsync("pnpm build", { cwd: rendererDir, timeout: 120_000 });

    // 2. Screenshot rendered page (returns data URI directly)
    const renderedDataUri = await screenshotPage(target.pagePath, rendererDir);

    // 3. Diff — wrap loadImageFn so the rendered data URI is returned as-is
    // (visionDiff calls loadImageFn for both images; the rendered image is already
    //  a data URI so we bypass the S3 fetch for it)
    const diff = await visionDiff(
      target.originalCropDesktop,
      renderedDataUri,
      chatFn,
      hybridLoadFn,
    );
    score = diff.score;
    issues = diff.issues;

    if (score >= PASS_THRESHOLD) break;

    // 4. Agent fix — only runs when score is below threshold
    const currentCode = fs.readFileSync(target.filePath, "utf8");
    const fixedCode = await agentFix(
      currentCode,
      target.originalCropDesktop,
      renderedDataUri,
      issues,
      chatFn,
      loadImageFn,
    );
    fs.writeFileSync(target.filePath, fixedCode, "utf8");
  }

  return {
    componentName: target.name,
    finalScore: score,
    iterations,
    passed: score >= PASS_THRESHOLD,
    remainingIssues: issues,
  };
}

async function screenshotPage(
  pagePath: string,
  rendererDir: string,
): Promise<string> {
  const distDir = path.join(rendererDir, "dist");
  const htmlFile =
    pagePath === "/"
      ? path.join(distDir, "index.html")
      : path.join(distDir, pagePath.replace(/^\//, ""), "index.html");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`file://${htmlFile}`, { waitUntil: "networkidle" });
    const buf = await page.screenshot({ fullPage: true });
    return `data:image/png;base64,${buf.toString("base64")}`;
  } finally {
    await browser.close();
  }
}

function extractMedia(uri: string): { mediaType: string; data: string } {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/);
  return { mediaType: match?.[1] ?? "image/png", data: match?.[2] ?? "" };
}

async function agentFix(
  componentCode: string,
  originalCropUrl: string,
  renderedDataUri: string,
  issues: VisionIssue[],
  chatFn: ChatFn,
  loadImageFn: (url: string) => Promise<string>,
): Promise<string> {
  const issueText = issues
    .map(
      (i) =>
        `- ${i.property}: expected "${i.expected}", got "${i.actual}" [${i.severity}]`,
    )
    .join("\n");

  const content: unknown[] = [
    {
      type: "text",
      text: `Fix this Astro component to match the original design.

ISSUES:
${issueText}

CURRENT CODE:
\`\`\`astro
${componentCode}
\`\`\`

Return ONLY the corrected .astro file content starting with ---.`,
    },
  ];

  try {
    const origData = await loadImageFn(originalCropUrl);
    const orig = extractMedia(origData);
    const rend = extractMedia(renderedDataUri);
    content.push(
      {
        type: "image",
        source: { type: "base64", media_type: orig.mediaType, data: orig.data },
      },
      { type: "text", text: "↑ Original. ↓ Current rendered output." },
      {
        type: "image",
        source: { type: "base64", media_type: rend.mediaType, data: rend.data },
      },
    );
  } catch (err) {
    console.warn("[eval-loop] Could not load images for agent fix:", err);
  }

  const fixed = await chatFn({
    messages: [{ role: "user", content }],
    maxTokens: 4096,
  });
  return fixed
    .replace(/^```(?:astro)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}
