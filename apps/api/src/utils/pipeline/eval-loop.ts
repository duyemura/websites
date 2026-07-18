import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { visionDiff, type VisionIssue } from "./visual-diff";
import { sanitizeAstroComponent } from "./astro-sanitize";

const execAsync = promisify(exec);
const PASS_THRESHOLD = 85;
const MAX_ITERATIONS = parseInt(process.env["MILO_EVAL_MAX_ITERATIONS"] ?? "5", 10);

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
  // Track the last-known-good component code so we can revert on build failure.
  let lastGoodCode = fs.readFileSync(target.filePath, "utf8");

  const hybridLoadFn = (url: string): Promise<string> =>
    url.startsWith("data:") ? Promise.resolve(url) : loadImageFn(url);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    iterations = i + 1;

    // 1. Build — revert to last-good code and exit this component's loop on failure.
    try {
      await execAsync("pnpm build", { cwd: rendererDir, timeout: 120_000 });
    } catch (buildErr) {
      console.warn(
        `[eval-loop] Build failed for ${target.name} (iteration ${i + 1}), reverting to last good version:`,
        buildErr instanceof Error ? buildErr.message : String(buildErr),
      );
      fs.writeFileSync(target.filePath, lastGoodCode, "utf8");
      break;
    }

    // 2. Screenshot rendered page (returns data URI directly)
    const { dataUri: renderedDataUri, foundComponent } = await screenshotPage(target, rendererDir);

    // 3. Diff — wrap loadImageFn so the rendered data URI is returned as-is
    const diff = await visionDiff(
      target.originalCropDesktop,
      renderedDataUri,
      chatFn,
      hybridLoadFn,
    );
    score = diff.score;
    issues = diff.issues;

    if (score >= PASS_THRESHOLD) break;

    if (diff.failed) {
      console.warn(`[eval-loop] Vision diff failed for ${target.name}, skipping fix for this iteration`);
      continue; // try the next iteration without patching the component
    }

    // Skip agentFix when the component wasn't found — the full-page fallback screenshot
    // gives the agent no meaningful signal, and it generates completely wrong components.
    if (!foundComponent) {
      console.warn(`[eval-loop] ${target.name} not on page — skipping agent fix to avoid corrupt rewrites`);
      continue;
    }

    // 4. Agent fix — only runs when diff succeeded, score < threshold, and component was found.
    // Snapshot current (good) code before writing the agent's attempt.
    lastGoodCode = fs.readFileSync(target.filePath, "utf8");
    const rawFixed = await agentFix(
      lastGoodCode,
      target.originalCropDesktop,
      renderedDataUri,
      issues,
      chatFn,
      loadImageFn,
    );
    // Apply the same sanitization as scaffoldTemplate to prevent agent-written
    // components from introducing .map()-on-undefined or CSS syntax errors.
    const fixedCode = sanitizeAstroComponent(rawFixed, target.name);
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
  target: ComponentTarget,
  rendererDir: string,
): Promise<{ dataUri: string; foundComponent: boolean }> {
  const distDir = path.join(rendererDir, "dist");
  const htmlFile = resolveHtmlFile(distDir, target.pagePath);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`file://${htmlFile}`, { waitUntil: "networkidle" });

    const element = page.locator(`[data-eval-component="${target.name}"]`);
    const count = await element.count();
    const isVisible = count > 0 && await element.first().isVisible();
    if (count === 0 || !isVisible) {
      const reason = count === 0 ? "not found" : "not visible";
      console.warn(`[eval-loop] data-eval-component="${target.name}" ${reason}, falling back to full-page screenshot`);
      const buf = await page.screenshot({ fullPage: true });
      return { dataUri: `data:image/png;base64,${buf.toString("base64")}`, foundComponent: false };
    }
    // Use .first() — the same component type may appear multiple times on the page.
    const buf = await element.first().screenshot();
    return { dataUri: `data:image/png;base64,${buf.toString("base64")}`, foundComponent: true };
  } finally {
    await browser.close();
  }
}

export function resolveHtmlFile(distDir: string, pagePath: string): string {
  if (pagePath === "/") return path.join(distDir, "index.html");
  const trimmed = pagePath.replace(/^\//, "");
  // Astro emits /foo/index.html for directory routes and /foo.html for
  // file-like routes. The crawled source path may already end in .html.
  if (trimmed.endsWith(".html")) {
    return path.join(distDir, trimmed);
  }
  return path.join(distDir, trimmed, "index.html");
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

RULES:
- Return ONLY the corrected .astro file content starting with ---
- Do NOT add any new import statements — this component is self-contained
- Do NOT import astro-icon, @iconify, lucide-react, react-icons, or any other package
- Fix ONLY CSS and layout — do not change the Props interface or template structure
- Apply exact colors, fonts, and spacing from the original screenshot`,
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
