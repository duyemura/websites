import type { Kysely } from "kysely";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { SiteSection } from "@ploy-gyms/shared-types";
import type { DesignSystem } from "../utils/design-system";
import type { DesignSystemV2 } from "../types/design-system-v2";
import type { HierarchyPage, HierarchySection } from "../types/site-hierarchy";
import { uploadBuildArtifacts } from "../utils/build-artifacts";
import { getSignedDownloadUrl } from "../s3";
import { renderSemanticSection } from "../utils/section-component-registry";

export interface RenderedSection {
  section: HierarchySection;
  source: string;
}

export interface GeneratePageInput {
  db: Kysely<DB>;
  config: Config;
  workspaceUuid: string;
  siteUuid: string;
  pageSlug: string;
  designSystem: DesignSystemV2;
  page: HierarchyPage;
  renderedSections: RenderedSection[];
  mode: "replication" | "template" | "greenfield";
  attemptId: string;
}

export interface GeneratePageOutput {
  attemptId: string;
  sourceDir: string;
  distDir: string;
  previewUrl: string;
  pageSections: HierarchySection[];
  metaTitle: string;
  metaDescription: string;
  buildSuccess: boolean;
  buildLog?: string;
  s3?: {
    bucket: string;
    previewKey: string;
    artifactPrefix: string;
  };
}

const ASTRO_VERSION = "^5.1.5";
const TAILWIND_INTEGRATION_VERSION = "^5.1.3";
const TAILWIND_VERSION = "3";
const ASSET_URL_EXPIRY_SECONDS = 24 * 60 * 60; // 1 day

function isAssetKey(key: string): boolean {
  return key.startsWith("workspaces/");
}

function extractAssetKey(url: string, config: Config): string | null {
  try {
    const parsed = new URL(url);
    const bucket = config.S3_ASSETS_BUCKET;
    const region = config.S3_REGION;

    // Virtual-hosted style: https://bucket.s3.region.amazonaws.com/key
    if (parsed.hostname === `${bucket}.s3.${region}.amazonaws.com`) {
      const key = decodeURIComponent(parsed.pathname.slice(1));
      return isAssetKey(key) ? key : null;
    }

    // Path-style AWS: https://s3.region.amazonaws.com/bucket/key
    if (parsed.hostname === `s3.${region}.amazonaws.com` && parsed.pathname.startsWith(`/${bucket}/`)) {
      const key = decodeURIComponent(parsed.pathname.slice(`/${bucket}/`.length));
      return isAssetKey(key) ? key : null;
    }

    // Path-style with custom endpoint: endpoint/bucket/key
    if (config.S3_ENDPOINT) {
      const base = config.S3_ENDPOINT.replace(/\/$/, "");
      const prefix = `${base}/${bucket}/`;
      if (url.startsWith(prefix)) {
        const key = decodeURIComponent(url.slice(prefix.length));
        return isAssetKey(key) ? key : null;
      }
    }
  } catch {
    // Not a URL we can parse; leave it alone.
  }
  return null;
}

async function signAssetUrl(url: string, config: Config): Promise<string> {
  const key = extractAssetKey(url, config);
  if (!key) return url;
  return getSignedDownloadUrl({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    sessionToken: config.S3_SESSION_TOKEN,
    bucket: config.S3_ASSETS_BUCKET,
    key,
    expiresIn: ASSET_URL_EXPIRY_SECONDS,
  });
}

async function signS3AssetUrls<T>(value: T, config: Config): Promise<T> {
  if (typeof value === "string") {
    return (await signAssetUrl(value, config)) as unknown as T;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      out.push(await signS3AssetUrls(item, config));
    }
    return out as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await signS3AssetUrls(v, config);
    }
    return out as unknown as T;
  }
  return value;
}

export async function generateAstroPage(input: GeneratePageInput): Promise<GeneratePageOutput> {
  const { config, workspaceUuid, siteUuid, pageSlug, designSystem, page, renderedSections, attemptId } = input;

  const sourceDir = path.join(os.tmpdir(), "ploy-gyms-build", siteUuid, attemptId, pageSlug);
  const distDir = path.join(sourceDir, "dist");

  await rm(sourceDir, { recursive: true, force: true });
  await mkdir(sourceDir, { recursive: true });

  // Sign private S3 asset URLs so the single-URL preview can load images
  // (logos, hero backgrounds, etc.) without requiring a separate proxy.
  const [signedDesignSystem, signedRenderedSections] = await Promise.all([
    signS3AssetUrls(designSystem, config),
    signS3AssetUrls(renderedSections, config),
  ]);

  await writeProjectFiles(sourceDir, signedDesignSystem, page, signedRenderedSections);

  const installResult = await runCommand("pnpm", ["install"], sourceDir);
  if (installResult.exitCode !== 0) {
    return failureOutput(attemptId, sourceDir, distDir, page, `pnpm install failed:\n${installResult.output}`);
  }

  const buildResult = await runCommand("pnpm", ["exec", "astro", "build"], sourceDir);
  if (buildResult.exitCode !== 0) {
    return failureOutput(attemptId, sourceDir, distDir, page, `astro build failed:\n${buildResult.output}`);
  }

  await relativizeAssetPaths(distDir);
  await inlineCssIntoHtml(distDir);

  const artifactUrls = await uploadBuildArtifacts({
    config,
    workspaceUuid,
    siteUuid,
    attemptId,
    pageSlug,
    sourceDir,
    distDir,
  });

  return {
    attemptId,
    sourceDir,
    distDir,
    previewUrl: artifactUrls.previewUrl,
    pageSections: page.sections,
    metaTitle: page.metaTitle ?? page.title,
    metaDescription: page.metaDescription ?? "",
    buildSuccess: true,
    buildLog: buildResult.output,
    s3: artifactUrls.s3,
  };
}

function failureOutput(
  attemptId: string,
  sourceDir: string,
  distDir: string,
  page: HierarchyPage,
  buildLog: string,
): GeneratePageOutput {
  return {
    attemptId,
    sourceDir,
    distDir,
    previewUrl: "",
    pageSections: page.sections,
    metaTitle: page.metaTitle ?? page.title,
    metaDescription: page.metaDescription ?? "",
    buildSuccess: false,
    buildLog,
  };
}

async function writeProjectFiles(
  sourceDir: string,
  designSystem: DesignSystemV2,
  page: HierarchyPage,
  renderedSections: RenderedSection[],
): Promise<void> {
  const dirs = [
    path.join(sourceDir, "src", "layouts"),
    path.join(sourceDir, "src", "components", "sections"),
    path.join(sourceDir, "src", "components", "shared"),
    path.join(sourceDir, "src", "pages"),
    path.join(sourceDir, "src", "styles"),
  ];
  await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })));

  await writeFile(path.join(sourceDir, "package.json"), packageJson());
  await writeFile(path.join(sourceDir, "astro.config.mjs"), astroConfig());
  await writeFile(path.join(sourceDir, "tailwind.config.mjs"), tailwindConfig());
  await writeFile(path.join(sourceDir, "tsconfig.json"), tsConfig());
  await writeFile(path.join(sourceDir, "src", "styles", "tokens.css"), tokensCss(designSystem));
  await writeFile(path.join(sourceDir, "src", "layouts", "Layout.astro"), layoutAstro(designSystem));

  const headerSection = designSystem.global.shell.header ?? makeDefaultHeader(designSystem);
  const primaryCta = page.primaryCta ?? (designSystem.reference as { homePagePrimaryCta?: { label?: string; href?: string } | null }).homePagePrimaryCta;
  if (primaryCta?.label && primaryCta.href) {
    headerSection.props.ctaLabel = primaryCta.label;
    headerSection.props.ctaHref = primaryCta.href;
  }
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Header.astro"),
    renderSemanticSection(headerSection),
  );
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Footer.astro"),
    renderSemanticSection(designSystem.global.shell.footer ?? makeDefaultFooter(designSystem)),
  );

  for (const { section, source } of renderedSections) {
    await writeFile(
      path.join(sourceDir, "src", "components", "sections", `${section.id}.astro`),
      source,
    );
  }

  const pageFileName = page.isHomePage ? "index.astro" : `${page.slug}.astro`;
  await writeFile(path.join(sourceDir, "src", "pages", pageFileName), pageAstro(page));
}

function packageJson(): string {
  return JSON.stringify(
    {
      name: "ploy-generated-site",
      type: "module",
      private: true,
      scripts: {
        build: "astro build",
        dev: "astro dev",
        preview: "astro preview",
      },
      dependencies: {
        astro: ASTRO_VERSION,
        "@astrojs/tailwind": TAILWIND_INTEGRATION_VERSION,
      },
      devDependencies: {
        tailwindcss: TAILWIND_VERSION,
        typescript: "~5.7.2",
      },
    },
    null,
    2,
  );
}

function astroConfig(): string {
  return `import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  output: "static",
  integrations: [tailwind()],
});
`;
}

async function relativizeAssetPaths(distDir: string): Promise<void> {
  const entries = await readdir(distDir, { withFileTypes: true, recursive: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.path ?? entry.parentPath ?? distDir, entry.name));

  await Promise.all(
    htmlFiles.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      const updated = content
        .replace(/href="\/_astro\//g, 'href="_astro/')
        .replace(/href="\/styles\//g, 'href="styles/')
        .replace(/src="\/_astro\//g, 'src="_astro/')
        .replace(/src="\/styles\//g, 'src="styles/');
      if (updated !== content) {
        await writeFile(filePath, updated, "utf8");
      }
    }),
  );
}

async function inlineCssIntoHtml(distDir: string): Promise<void> {
  const entries = await readdir(distDir, { withFileTypes: true, recursive: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.path ?? entry.parentPath ?? distDir, entry.name));

  await Promise.all(
    htmlFiles.map(async (filePath) => {
      let content = await readFile(filePath, "utf8");
      const linkTags = [...content.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
      for (const match of linkTags) {
        const [tag, href] = match;
        if (!href) continue;
        const cssPath = path.join(distDir, href);
        try {
          const css = await readFile(cssPath, "utf8");
          content = content.replace(tag, `<style>${css}</style>`);
        } catch {
          // Leave the link tag if the CSS file cannot be read.
        }
      }
      await writeFile(filePath, content, "utf8");
    }),
  );
}

function tailwindConfig(): string {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
`;
}

function tsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        jsx: "preserve",
        jsxImportSource: "astro",
        skipLibCheck: true,
      },
      include: ["src/**/*"],
    },
    null,
    2,
  );
}

function tokensCss(designSystem: DesignSystem | DesignSystemV2): string {
  const tokens = designSystem.global.tokens;
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-primary: ${tokens.colors.primary};
  --color-primary-foreground: ${tokens.colors.primaryForeground};
  --color-background: ${tokens.colors.background};
  --color-foreground: ${tokens.colors.foreground};
  --color-muted: ${tokens.colors.muted};
  --color-muted-foreground: ${tokens.colors.mutedForeground};
  --color-border: ${tokens.colors.border};
  --font-heading: ${tokens.fonts.heading};
  --font-body: ${tokens.fonts.body};
  --radius: ${tokens.radius};
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-body);
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
}
`;
}

function layoutAstro(designSystem: DesignSystem | DesignSystemV2): string {
  const businessName = designSystem.business.name ?? "Ploy for gyms";
  return `---
import Header from "../components/shared/Header.astro";
import Footer from "../components/shared/Footer.astro";
import "../styles/tokens.css";

export interface Props {
  title?: string;
  description?: string;
}

const { title = ${JSON.stringify(businessName)}, description } = Astro.props;
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {description && <meta name="description" content={description} />}
  </head>
  <body class="min-h-screen flex flex-col">
    <Header />
    <main class="flex-1">
      <slot />
    </main>
    <Footer />
  </body>
</html>
`;
}

export function makeDefaultHeader(designSystem: DesignSystem | DesignSystemV2): SiteSection {
  return {
    id: "header",
    type: "SiteHeader",
    props: {
      logo: { type: "text", value: designSystem.business.name ?? "Home" },
      navLinks: designSystem.global.shell.navLinks ?? [],
    },
  };
}

export function makeDefaultFooter(designSystem: DesignSystem | DesignSystemV2): SiteSection {
  const year = new Date().getFullYear();
  const businessName = designSystem.business.name ?? "";
  return {
    id: "footer",
    type: "SiteFooter",
    props: {
      businessName,
      navLinks: designSystem.global.shell.navLinks ?? [],
      copyright: businessName ? `© ${year} ${businessName}. All rights reserved.` : `© ${year}`,
    },
  };
}

function toComponentName(value: string): string {
  return value
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("")
    .replace(/[^a-zA-Z0-9_$]/g, "")
    .replace(/^(?=[0-9])/, "_");
}

function pageAstro(page: HierarchyPage): string {
  const title = page.metaTitle ?? page.title;
  const description = page.metaDescription ?? "";
  const imports = page.sections
    .map((section) => {
      const componentName = toComponentName(section.id);
      const fileName = section.id;
      return `import ${componentName} from "../components/sections/${fileName}.astro";`;
    })
    .join("\n");

  const renderedSections = page.sections
    .map((section) => {
      const componentName = toComponentName(section.id);
      return `    <${componentName} />`;
    })
    .join("\n");

  return `---
import Layout from "../layouts/Layout.astro";
${imports}
---

<Layout title=${JSON.stringify(title)} description=${JSON.stringify(description)}>
${renderedSections}
</Layout>
`;
}

function runCommand(command: string, args: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, output: [stdout, stderr].filter(Boolean).join("\n") });
    });
    child.on("error", (err) => {
      resolve({ exitCode: 1, output: `spawn error: ${err.message}` });
    });
  });
}
