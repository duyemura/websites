import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { chatCompletion } from "../../ai/llm-client";
import { modelForTask } from "../../ai/model-picker";
import type { Config } from "../../plugins/env";

const execAsync = promisify(exec);

export interface TemplateFix {
  fixDescription: string;
  templateName: string;
  sourceUrl: string;
  deployedUrl: string;
  rendererDir: string;
  config: Config;
  maxIterations?: number;
}

export interface TemplateFixResult {
  componentFile: string;
  componentName: string;
  applied: boolean;
  iterations: number;
  summary: string;
}

// ── Step 1: identify the component to fix ────────────────────────────────────

async function identifyComponent(
  fixDescription: string,
  templateName: string,
  rendererDir: string,
  config: Config,
): Promise<{ componentName: string; filePath: string; isChromeComponent: boolean }> {
  const componentsDir = path.join(rendererDir, "src/components/sections", templateName);
  const chromeDir = path.join(rendererDir, "src/components/chrome");

  const sectionFiles = fs.existsSync(componentsDir)
    ? fs.readdirSync(componentsDir).filter((f) => f.endsWith(".astro")).map((f) => f.replace(".astro", ""))
    : [];

  const chromeFiles = fs.existsSync(chromeDir)
    ? fs.readdirSync(chromeDir)
        .filter((f) => f.toLowerCase().includes(templateName) && f.endsWith(".astro"))
        .map((f) => f.replace(".astro", ""))
    : [];

  const allComponents = [
    ...chromeFiles.map((n) => ({ name: n, type: "chrome", path: path.join(chromeDir, `${n}.astro`) })),
    ...sectionFiles.map((n) => ({ name: n, type: "section", path: path.join(componentsDir, `${n}.astro`) })),
  ];

  const componentList = allComponents
    .map((c) => `  ${c.name} (${c.type})`)
    .join("\n");

  const prompt = `You are helping fix a specific issue in an Astro website template called "${templateName}".

FIX REQUESTED: "${fixDescription}"

Available components:
${componentList}

Which single component file should be edited to fix this? Respond with ONLY the component name (exactly as listed above), nothing else.

Hints:
- Nav/menu issues → HeaderModern or Header component
- Footer issues → FooterModern or Footer component
- Hero issues → Hero or HeroCenter component
- Program listing issues → Programs component
- Testimonial issues → Testimonials component
- FAQ issues → FAQ component
- Location/address issues → Location component
- Steps/getting started issues → HowItWorks component
- Feature grid/amenities issues → Amenities or CoreValues component`;

  const model = modelForTask("default", config);
  const resp = await chatCompletion(
    { model, messages: [{ role: "user", content: prompt }], maxTokens: 50 },
    config,
  );

  const componentName = resp.content.trim().replace(".astro", "");
  const match = allComponents.find((c) => c.name === componentName);

  if (!match) {
    // Fallback: use the component with the best keyword match
    const descLower = fixDescription.toLowerCase();
    const fallback =
      allComponents.find((c) => descLower.includes(c.name.toLowerCase())) ??
      allComponents[0];
    return {
      componentName: fallback?.name ?? componentName,
      filePath: fallback?.path ?? path.join(componentsDir, `${componentName}.astro`),
      isChromeComponent: fallback?.type === "chrome",
    };
  }

  return {
    componentName: match.name,
    filePath: match.path,
    isChromeComponent: match.type === "chrome",
  };
}

// ── Step 2: screenshot both URLs ──────────────────────────────────────────────

async function screenshotUrls(
  sourceUrl: string,
  deployedUrl: string,
): Promise<{ sourcePng: Buffer; deployedPng: Buffer }> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(sourceUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const sourcePng = await page.screenshot({ fullPage: false });

    await page.goto(deployedUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const deployedPng = await page.screenshot({ fullPage: false });

    return { sourcePng, deployedPng };
  } finally {
    await browser.close();
  }
}

// ── Step 3: Claude writes the fix ─────────────────────────────────────────────

async function generateFix(
  fixDescription: string,
  componentName: string,
  currentCode: string,
  sourcePng: Buffer,
  deployedPng: Buffer,
  config: Config,
): Promise<string> {
  const model = modelForTask("vision", config);

  const content: unknown[] = [
    {
      type: "text",
      text: `Fix the following issue in this Astro component named "${componentName}".

ISSUE: "${fixDescription}"

CURRENT CODE:
\`\`\`astro
${currentCode}
\`\`\`

Image 1 (↓) is the SOURCE TEMPLATE. Image 2 (↓) is the CURRENT DEPLOYED VERSION.
Study the difference to understand what specifically needs to change.

RULES:
- Return ONLY the complete corrected .astro file starting with ---
- Do NOT add new import statements
- Do NOT import astro-icon, @iconify, lucide-react, or any other package
- Preserve all existing functionality — only fix what the issue describes
- Keep all CSS custom properties (var(--modern-accent) etc.)`,
    },
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: sourcePng.toString("base64") },
    },
    { type: "text", text: "↑ Source template. ↓ Current deployed version." },
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: deployedPng.toString("base64") },
    },
  ];

  const resp = await chatCompletion(
    {
      model,
      messages: [{ role: "user", content }],
      maxTokens: 8192,
    },
    config,
  );

  // Strip markdown fences if present
  return resp.content
    .replace(/^```(?:astro)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

// ── Main service ──────────────────────────────────────────────────────────────

export async function runTemplateFix(input: TemplateFix): Promise<TemplateFixResult> {
  const {
    fixDescription,
    templateName,
    sourceUrl,
    deployedUrl,
    rendererDir,
    config,
    maxIterations = 3,
  } = input;

  // 1. Identify which component to fix
  const { componentName, filePath } = await identifyComponent(
    fixDescription,
    templateName,
    rendererDir,
    config,
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(`Component file not found: ${filePath}`);
  }

  // 2. Screenshot source + deployed (once, before any changes)
  const { sourcePng, deployedPng } = await screenshotUrls(sourceUrl, deployedUrl);

  let iterations = 0;
  let lastCode = fs.readFileSync(filePath, "utf8");

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;

    // 3. Generate fix
    const fixedCode = await generateFix(
      fixDescription,
      componentName,
      lastCode,
      sourcePng,
      deployedPng,
      config,
    );

    if (!fixedCode.startsWith("---")) {
      console.warn(`[template-fix] Iteration ${iterations}: LLM response did not start with --- — skipping`);
      continue;
    }

    // 4. Write the fix
    fs.writeFileSync(filePath, fixedCode, "utf8");
    lastCode = fixedCode;

    // 5. Build the renderer to verify it compiles
    try {
      await execAsync("pnpm build", { cwd: rendererDir, timeout: 120_000 });
      // Build succeeded — done
      break;
    } catch (err) {
      console.warn(`[template-fix] Iteration ${iterations}: build failed, reverting and retrying`);
      // Revert and try again
      fs.writeFileSync(filePath, lastCode, "utf8");
    }
  }

  return {
    componentFile: filePath,
    componentName,
    applied: true,
    iterations,
    summary: `Applied fix to ${componentName} in ${iterations} iteration(s). Run "milo template --stages template --force" to deploy.`,
  };
}
