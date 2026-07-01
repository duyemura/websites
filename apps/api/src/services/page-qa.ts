import type { Kysely } from "kysely";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { ChatContentPart } from "../ai/llm-client";
import { callLlmAndLog } from "../ai/llm-with-logging";

export interface QaIssue {
  component_id: string;
  category: string;
  severity: "high" | "medium" | "low";
  description: string;
  suggested_fix: string;
}

export interface PageQaInput {
  db: Kysely<DB>;
  config: Config;
  workspaceUuid: string;
  siteUuid: string;
  pageSlug: string;
  aiJobUuid: string;
  distDir: string;
  previewUrl: string;
  referenceScreenshotUrl?: string | null;
  mode: "replication" | "template" | "greenfield";
  fidelityThreshold?: number;
}

export interface PageQaOutput {
  passed: boolean;
  fidelityScore: number;
  issues: QaIssue[];
  screenshots: { desktop: string; mobile?: string };
  previewUrl: string;
}

export async function runPageQa(input: PageQaInput): Promise<PageQaOutput> {
  const { mode, referenceScreenshotUrl, fidelityThreshold = 0.85 } = input;

  const server = await serveStaticDir(input.distDir);
  let currentScreenshot: Buffer;

  try {
    currentScreenshot = await captureScreenshot(server.url, { width: 1280, height: 800 });
  } finally {
    server.close();
  }

  const desktopDataUrl = `data:image/png;base64,${currentScreenshot.toString("base64")}`;

  let fidelityScore: number;
  if (mode === "replication" && referenceScreenshotUrl) {
    const referenceBuffer = await fetchImageBuffer(referenceScreenshotUrl);
    fidelityScore = referenceBuffer ? computeFidelity(currentScreenshot, referenceBuffer) : 0;
  } else {
    fidelityScore = 1;
  }

  const issues = await runVisualQa({
    ...input,
    generatedScreenshotDataUrl: desktopDataUrl,
    referenceScreenshotUrl: referenceScreenshotUrl ?? null,
    fidelityScore,
  });

  const passed = fidelityScore >= fidelityThreshold && !issues.some((i) => i.severity === "high");

  return {
    passed,
    fidelityScore,
    issues,
    screenshots: { desktop: desktopDataUrl },
    previewUrl: input.previewUrl,
  };
}

interface StaticServer {
  url: string;
  close: () => void;
}

async function serveStaticDir(rootDir: string): Promise<StaticServer> {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    const filePath = path.join(rootDir, pathname === "/" ? "index.html" : pathname);
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": contentTypeForPath(filePath) });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://localhost:${port}`, close: () => server.close() };
}

async function captureScreenshot(url: string, viewport: { width: number; height: number }): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(500);
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    return buffer;
  } finally {
    await browser.close();
  }
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      if (comma === -1) return null;
      const base64 = url.slice(comma + 1);
      return Buffer.from(base64, "base64");
    }
    const response = await fetch(url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function computeFidelity(generated: Buffer, reference: Buffer): number {
  const a = PNG.sync.read(generated);
  const b = PNG.sync.read(reference);

  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const totalPixels = width * height;
  if (totalPixels === 0) return 0;

  const canvasA = padTo(a, width, height);
  const canvasB = padTo(b, width, height);

  const diff = Buffer.alloc(width * height * 4);
  const diffCount = pixelmatch(canvasA, canvasB, diff, width, height, { threshold: 0.1 });
  return Math.max(0, Math.min(1, 1 - diffCount / totalPixels));
}

function padTo(png: PNG, width: number, height: number): Buffer {
  const output = Buffer.alloc(width * height * 4, 0xff);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      output[dstIdx] = png.data[srcIdx]!;
      output[dstIdx + 1] = png.data[srcIdx + 1]!;
      output[dstIdx + 2] = png.data[srcIdx + 2]!;
      output[dstIdx + 3] = png.data[srcIdx + 3]!;
    }
  }
  return output;
}

interface VisualQaInput extends Pick<PageQaInput, "db" | "config" | "workspaceUuid" | "siteUuid" | "pageSlug" | "aiJobUuid" | "mode"> {
  generatedScreenshotDataUrl: string;
  referenceScreenshotUrl: string | null;
  fidelityScore: number;
}

async function runVisualQa(input: VisualQaInput): Promise<QaIssue[]> {
  const parts: ChatContentPart[] = [
    {
      type: "text",
      text: buildVisualQaPrompt(input.mode, input.fidelityScore),
    },
    { type: "image_url", image_url: { url: input.generatedScreenshotDataUrl } },
  ];

  if (input.referenceScreenshotUrl) {
    parts.push({
      type: "text",
      text: "Here is the reference screenshot of the source site for comparison.",
    });
    parts.push({ type: "image_url", image_url: { url: input.referenceScreenshotUrl } });
  }

  const result = await callLlmAndLog(
    {
      db: input.db,
      workspaceUuid: input.workspaceUuid,
      userUuid: "system",
      siteUuid: input.siteUuid,
      aiJobUuid: input.aiJobUuid,
    },
    {
      agent: "visual-qa",
      actionType: "qa",
      promptTemplateKeys: ["visual-qa-evaluator"],
      summary: `Visual QA review for ${input.siteUuid}/${input.pageSlug}`,
      messages: [
        { role: "system", content: systemVisualQaPrompt() },
        { role: "user", content: parts },
      ],
      jsonMode: true,
      temperature: 0.2,
      postCall: (response) => {
        const parsed = parseQaIssues(response.content);
        return {
          outcome: parsed ? "success" : "partial",
          summary: `Visual QA returned ${parsed?.length ?? 0} issues`,
          errorMessage: parsed ? null : "Could not parse visual QA response",
        };
      },
    },
    input.config,
  );

  if (result.outcome !== "success" || !result.response.content) {
    return [];
  }
  return parseQaIssues(result.response.content) ?? [];
}

function systemVisualQaPrompt(): string {
  return `You are a meticulous visual QA engineer for an AI website builder.
Your job is to compare a generated webpage screenshot against the source site screenshot (when available) and list concrete visual issues.

Return ONLY a JSON object with this shape:
{
  "issues": [
    {
      "component_id": "section id or 'global'",
      "category": "layout | color | typography | spacing | image | content | link | responsive",
      "severity": "high" | "medium" | "low",
      "description": "specific issue description",
      "suggested_fix": "concise fix instruction"
    }
  ]
}

Rules:
- If the generated page matches the reference closely and there are no obvious defects, return an empty issues array.
- Focus on user-visible defects, not code style.
- Severity high = blocks launch (broken layout, missing hero, wrong brand color).
- Do not invent issues that are not visible in the screenshots.`;
}

function buildVisualQaPrompt(mode: string, fidelityScore: number): string {
  return mode === "replication"
    ? `Compare the generated page (first image) to the reference source site (second image). Pixel fidelity score: ${fidelityScore.toFixed(2)}.`
    : `Review the generated page (first image) for build, content, and responsive quality.`;
}

function parseQaIssues(raw: string): QaIssue[] | null {
  try {
    const cleaned = raw.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as { issues?: unknown[] };
    if (!Array.isArray(parsed.issues)) return null;
    return parsed.issues.filter(isQaIssue);
  } catch {
    return null;
  }
}

function isQaIssue(value: unknown): value is QaIssue {
  if (!value || typeof value !== "object") return false;
  const issue = value as Record<string, unknown>;
  return (
    typeof issue.component_id === "string" &&
    typeof issue.category === "string" &&
    typeof issue.description === "string" &&
    typeof issue.suggested_fix === "string" &&
    ["high", "medium", "low"].includes(issue.severity as string)
  );
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".css":
      return "text/css";
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
