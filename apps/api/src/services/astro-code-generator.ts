import type { ExtractedNav, NavLink } from "../types/pipeline-artifacts";
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
  /** Map of sharedComponentId → rendered Astro component source. */
  sharedComponents?: Map<string, string>;
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
        const rest = url.slice(prefix.length);
        const key = decodeURIComponent((rest.split("?")[0] ?? ""));
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

export async function signS3AssetUrls<T>(value: T, config: Config): Promise<T> {
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

  // Callers must sign private S3 asset URLs before passing rendered sections
  // and the design system in; buildPage already does this.
  await writeProjectFiles(sourceDir, designSystem, page, renderedSections, input.sharedComponents);

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
  sharedComponents?: Map<string, string>,
): Promise<void> {
  await writeProjectScaffold(sourceDir, designSystem);
  await writeSharedComponents(sourceDir, designSystem, page, sharedComponents);
  await writePageFiles(sourceDir, page, renderedSections);
}

/**
 * Write the top-level Astro project scaffold (package.json, config, tokens,
 * layout, tsconfig). Safe to call multiple times — later calls overwrite the
 * same files with identical content. Exposed for the build stage which writes
 * an N-page project.
 */
export interface WriteProjectScaffoldOpts {
  webFontUrls?: string[];
  cssAnimations?: { name: string; css: string }[];
  hasLottie?: boolean;
}

export async function writeProjectScaffold(
  sourceDir: string,
  designSystem: DesignSystemV2,
  opts?: WriteProjectScaffoldOpts,
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
  await writeFile(path.join(sourceDir, "tailwind.config.mjs"), tailwindConfig(opts?.cssAnimations ?? []));
  await writeFile(path.join(sourceDir, "tsconfig.json"), tsConfig());
  await writeFile(path.join(sourceDir, "src", "styles", "tokens.css"), tokensCss(designSystem));
  await writeFile(
    path.join(sourceDir, "src", "layouts", "Layout.astro"),
    layoutAstro(designSystem, opts?.webFontUrls ?? [], opts?.cssAnimations ?? [], opts?.hasLottie ?? false),
  );
}

async function writeSharedComponents(
  sourceDir: string,
  designSystem: DesignSystemV2,
  _page: HierarchyPage,
  sharedComponents?: Map<string, string>,
): Promise<void> {
  const headerSection = designSystem.global.shell.header ?? makeDefaultHeader(designSystem);
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Header.astro"),
    renderSemanticSection(headerSection),
  );
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Footer.astro"),
    renderSemanticSection(designSystem.global.shell.footer ?? makeDefaultFooter(designSystem)),
  );

  if (sharedComponents) {
    for (const [id, source] of sharedComponents) {
      await writeFile(
        path.join(sourceDir, "src", "components", "shared", `${sharedComponentFileName(id)}.astro`),
        source,
      );
    }
  }
}

/**
 * Write the section files for one page + the top-level page file. Section
 * components with a `sharedComponentId` are NOT written here — the page file
 * imports them from `../components/shared/{id}.astro`. Safe to call once per
 * page in a multi-page project.
 */
export async function writePageFiles(
  sourceDir: string,
  page: HierarchyPage,
  renderedSections: RenderedSection[],
): Promise<void> {
  const sharedIds = new Set(
    page.sections.filter((s) => s.sharedComponentId).map((s) => s.sharedComponentId as string),
  );

  for (const { section, source } of renderedSections) {
    // Skip writing per-section files for sections that resolve to a shared
    // component — the page imports the shared file directly.
    if (section.sharedComponentId) continue;
    await writeFile(
      path.join(sourceDir, "src", "components", "sections", `${section.id}.astro`),
      source,
    );
  }

  const pageFileName = page.isHomePage ? "index.astro" : `${page.slug}.astro`;
  await writeFile(
    path.join(sourceDir, "src", "pages", pageFileName),
    pageAstro(page, sharedIds),
  );
}

export function sharedComponentFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-");
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

export async function relativizeAssetPaths(distDir: string): Promise<void> {
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

export async function inlineCssIntoHtml(distDir: string): Promise<void> {
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

function tailwindConfig(cssAnimations: { name: string; css: string }[] = []): string {
  // Build animation + keyframes extend blocks only when animations were captured.
  let animationExtend = "";
  if (cssAnimations.length > 0) {
    const animationEntries = cssAnimations
      .map((a) => `      "${a.name}": "${a.name} 1s ease both"`)
      .join(",\n");
    // Keyframes: extract the @keyframes body for each captured animation.
    // The LLM already has the CSS injected in Layout.astro global styles, but
    // Tailwind also needs the keyframe registered so `animate-{name}` works.
    const keyframeEntries = cssAnimations
      .map((a) => {
        // Strip the @keyframes name { ... } wrapper and keep the inner body.
        const inner = a.css.replace(/^@keyframes\s+\S+\s*\{/, "").replace(/\}\s*$/, "").trim();
        return `      "${a.name}": { ${inner.replace(/\n/g, " ")} }`;
      })
      .join(",\n");
    animationExtend = `\n      animation: {\n${animationEntries}\n      },\n      keyframes: {\n${keyframeEntries}\n      },`;
  }

  return `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}"],
  theme: {
    extend: {
      // Map design token CSS variables to named Tailwind utilities so the LLM
      // can write natural classes like bg-primary, text-foreground, font-heading
      // instead of the verbose bg-[var(--color-primary)] arbitrary-value syntax.
      colors: {
        primary: "var(--color-primary)",
        "primary-fg": "var(--color-primary-foreground)",
        "primary-accent": "var(--color-primary)",
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        muted: "var(--color-muted)",
        "muted-fg": "var(--color-muted-foreground)",
        "muted-surface": "var(--color-muted)",
        border: "var(--color-border)",
        accent: "var(--color-primary)",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      borderRadius: {
        site: "var(--radius)",
      },${animationExtend}
    },
  },
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

function layoutAstro(
  designSystem: DesignSystem | DesignSystemV2,
  webFontUrls: string[] = [],
  cssAnimations: { name: string; css: string }[] = [],
  hasLottie = false,
): string {
  const businessName = designSystem.business.name ?? "Ploy for gyms";

  // Build the keyframes block: inject captured animations into global CSS.
  const keyframesBlock = cssAnimations.length > 0
    ? `\n  <style is:global>\n${cssAnimations.map((a) => `    ${a.css}`).join("\n")}\n  </style>`
    : "";

  // Lottie player CDN — only injected when the site uses Lottie animations.
  const lottieScript = hasLottie
    ? `\n    <script src="https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js"></script>`
    : "";

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
    ${webFontUrls.map(url => `<link rel="stylesheet" href="${url}" />`).join("\n    ")}
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>${lottieScript}
  </head>
  <body class="min-h-screen flex flex-col">
    <Header />
    <main class="flex-1">
      <slot />
    </main>
    <Footer />
  </body>
</html>${keyframesBlock}
`;
}

/**
 * Render a complete, self-contained Astro nav component from deterministically
 * extracted nav data. No LLM involved — uses exact computed values from the DOM.
 * Uses Alpine.js for mobile toggle and dropdown interactivity.
 */
export function renderNavComponent(nav: ExtractedNav): string {
  const logoHtml =
    nav.logo.type === "image"
      ? `<img src="${nav.logo.value}" alt="${nav.logo.alt ?? ""}" class="h-8 w-auto" />`
      : `<span class="font-bold text-lg" style="color:${nav.textColor}">${nav.logo.value}</span>`;

  function renderNavLink(link: NavLink, depth = 0): string {
    if (link.children && link.children.length > 0) {
      const childItems = link.children.map((c: NavLink) => renderNavLink(c, depth + 1)).join("\n          ");
      return `<li class="relative" x-data="{ open: false }">
          <button
            @click="open = !open"
            @mouseenter="open = true"
            @mouseleave="open = false"
            class="flex items-center gap-1 px-3 py-2 hover:opacity-80 transition-opacity"
            style="color:${nav.textColor}"
          >
            ${link.label}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <ul
            x-show="open"
            @mouseenter="open = true"
            @mouseleave="open = false"
            x-transition
            class="absolute top-full left-0 z-50 min-w-48 py-1 shadow-lg rounded"
            style="background:${nav.background}"
          >
            ${childItems}
          </ul>
        </li>`;
    }
    const isTopLevel = depth === 0;
    return `<li>
          <a
            href="${link.href}"
            class="${isTopLevel ? "px-3 py-2 hover:opacity-80 transition-opacity" : "block px-4 py-2 hover:opacity-80 transition-opacity"}"
            style="color:${nav.textColor}"
          >${link.label}</a>
        </li>`;
  }

  const desktopLinks = nav.links.map((l) => renderNavLink(l, 0)).join("\n        ");

  function renderMobileLink(link: NavLink): string {
    if (link.children && link.children.length > 0) {
      const childItems = link.children
        .map(
          (c: NavLink) =>
            `<a href="${c.href}" class="block pl-6 pr-4 py-2 text-sm hover:opacity-80 transition-opacity" style="color:${nav.textColor}">${c.label}</a>`,
        )
        .join("\n              ");
      return `<div x-data="{ open: false }">
              <button
                @click="open = !open"
                class="flex items-center justify-between w-full px-4 py-2 hover:opacity-80 transition-opacity"
                style="color:${nav.textColor}"
              >
                ${link.label}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div x-show="open" x-transition>
                ${childItems}
              </div>
            </div>`;
    }
    return `<a href="${link.href}" class="block px-4 py-2 hover:opacity-80 transition-opacity" style="color:${nav.textColor}">${link.label}</a>`;
  }

  const mobileLinks = nav.links.map((l) => renderMobileLink(l)).join("\n            ");

  const ctaHtml = nav.cta
    ? `<a
            href="${nav.cta.href}"
            class="ml-4 px-4 py-2 rounded font-medium transition-opacity hover:opacity-90"
            style="background:${nav.cta.background};color:${nav.cta.color};border-radius:${nav.cta.borderRadius}"
          >${nav.cta.label}</a>`
    : "";

  const mobileCtaHtml = nav.cta
    ? `<a
              href="${nav.cta.href}"
              class="block mx-4 mt-2 mb-1 px-4 py-2 rounded font-medium text-center transition-opacity hover:opacity-90"
              style="background:${nav.cta.background};color:${nav.cta.color};border-radius:${nav.cta.borderRadius}"
            >${nav.cta.label}</a>`
    : "";

  const positionClass =
    nav.position === "top-fixed"
      ? "fixed top-0 left-0 right-0 z-50"
      : nav.position === "top-sticky"
        ? "sticky top-0 z-50"
        : "relative";

  return `---
// Deterministically generated nav — do not edit by hand.
// Source: ExtractedNav from extract stage.
---

<header
  data-section-id="shell-header"
  class="${positionClass} w-full"
  style="background:${nav.background}"
  x-data="{ mobileOpen: false }"
>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <nav class="flex items-center justify-between h-16">

      <!-- Logo -->
      <div class="flex-shrink-0">
        <a href="/" aria-label="Home">
          ${logoHtml}
        </a>
      </div>

      <!-- Desktop links -->
      <ul class="hidden md:flex items-center list-none m-0 p-0 gap-1">
        ${desktopLinks}
        ${ctaHtml ? `<li>${ctaHtml}</li>` : ""}
      </ul>

      <!-- Mobile hamburger -->
      <button
        class="md:hidden flex items-center justify-center w-10 h-10 rounded hover:opacity-80 transition-opacity"
        style="color:${nav.textColor}"
        @click="mobileOpen = !mobileOpen"
        aria-label="Toggle menu"
        :aria-expanded="mobileOpen"
      >
        <svg x-show="!mobileOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <svg x-show="mobileOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

    </nav>
  </div>

  <!-- Mobile menu panel -->
  <div
    x-show="mobileOpen"
    x-transition:enter="transition ease-out duration-200"
    x-transition:enter-start="opacity-0 -translate-y-2"
    x-transition:enter-end="opacity-100 translate-y-0"
    x-transition:leave="transition ease-in duration-150"
    x-transition:leave-start="opacity-100 translate-y-0"
    x-transition:leave-end="opacity-0 -translate-y-2"
    class="md:hidden pb-3 border-t"
    style="background:${nav.mobileMenuBackground};border-color:${nav.textColor}22"
  >
    <div class="flex flex-col pt-2">
      ${mobileLinks}
      ${mobileCtaHtml}
    </div>
  </div>
</header>
`;
}

export interface FooterLinkGroup {
  heading?: string;
  links: { label: string; href: string }[];
}

/** Deterministic footer renderer from extracted DOM data.
 *  Supports column groups (PROGRAMS/ABOUT/LEGAL), logo, social links. */
export function renderFooterComponent(footer: {
  background: string;
  textColor: string;
  brandName: string;
  logoUrl?: string;
  links: { label: string; href: string }[];
  copyright: string;
  /** Grouped link columns — extracted from DOM structure when available. */
  linkGroups?: FooterLinkGroup[];
  /** Social links (Facebook, Instagram, etc.) */
  socialLinks?: { platform: string; href: string; iconSvg?: string }[];
  /** Physical address text if present */
  address?: string;
}): string {
  // Link text color: on dark backgrounds use white, on light use dark
  const bg = footer.background;
  const isDark = bg.match(/rgba?\((\d+)/) ? +(bg.match(/rgba?\((\d+)/) ?? [])[1]! < 128 : true;
  const linkColor = isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.7)";
  const headingColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const dividerColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const textColor = isDark ? "#fff" : footer.textColor;

  // Logo: object-contain + self-start prevents flex-stretch distortion for any aspect ratio
  const logoHtml = footer.logoUrl
    ? `<img src="${footer.logoUrl}" alt="${footer.brandName}" class="max-h-12 w-auto object-contain self-start mb-3" style="filter:${isDark ? "brightness(10)" : "none"}" />`
    : footer.brandName
      ? `<div class="text-base font-bold mb-3" style="color:${textColor}">${footer.brandName}</div>`
      : "";

  // Social links — rendered as SVG icons, not text, for any platform we recognise.
  const socialIconSvg = (platform: string): string => {
    const p = platform.toLowerCase();
    if (p.includes("facebook")) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.563 9.876v-6.988H7.9V12h2.537V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.888H13.56v6.988A10.003 10.003 0 0 0 22 12z"/></svg>`;
    if (p.includes("instagram")) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.366.062 2.633.326 3.608 1.301.975.975 1.24 2.242 1.302 3.608.058 1.265.069 1.645.069 4.849s-.011 3.584-.069 4.849c-.062 1.366-.327 2.633-1.302 3.608-.975.975-2.242 1.24-3.608 1.302-1.265.058-1.645.069-4.85.069s-3.584-.011-4.849-.069c-1.366-.062-2.633-.327-3.608-1.302-.975-.975-1.24-2.242-1.301-3.608C2.175 15.747 2.163 15.367 2.163 12s.012-3.584.07-4.849c.061-1.366.326-2.633 1.301-3.608.975-.975 2.242-1.239 3.608-1.301C8.416 2.175 8.796 2.163 12 2.163zm0-2.163C8.741 0 8.333.014 7.053.072 5.775.131 4.602.333 3.635 1.3 2.667 2.268 2.464 3.44 2.405 4.719 2.347 6 2.333 6.408 2.333 12c0 5.592.014 6 .072 7.281.059 1.279.262 2.451 1.229 3.419.968.967 2.14 1.17 3.419 1.229C8.333 23.986 8.741 24 12 24s3.667-.014 4.947-.072c1.279-.059 2.451-.262 3.419-1.229.967-.968 1.17-2.14 1.229-3.419.058-1.281.072-1.689.072-7.28s-.014-6-.072-7.281c-.059-1.279-.262-2.451-1.229-3.419C19.398.333 18.226.131 16.947.072 15.667.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`;
    if (p.includes("twitter") || p.includes("x.com")) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
    if (p.includes("youtube")) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
    if (p.includes("linkedin")) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`;
    // Unknown platform — fall back to first letter in a circle
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid currentColor;font-size:10px;font-weight:bold;" aria-hidden="true">${platform.charAt(0).toUpperCase()}</span>`;
  };

  const socialHtml = (footer.socialLinks ?? []).map(s =>
    `<a href="${s.href}" aria-label="${s.platform}" title="${s.platform}" class="hover:opacity-60 transition-opacity" style="color:${textColor};display:inline-flex;align-items:center;">${socialIconSvg(s.platform)}</a>`
  ).join("\n        ");

  // Columns: use groups if available, otherwise split flat links into one column
  const groups: FooterLinkGroup[] = footer.linkGroups?.length
    ? footer.linkGroups
    : [{ links: footer.links }];

  const isAddressGroup = (heading?: string) =>
    !!heading && /address|location|find us|where/i.test(heading);

  const columnsHtml = groups.map(g => `
    <div>
      ${g.heading ? `<div class="mb-3 text-xs font-semibold uppercase tracking-widest" style="color:${headingColor}">${g.heading.charAt(0).toUpperCase() + g.heading.slice(1).toLowerCase()}</div>` : ""}
      ${isAddressGroup(g.heading) && footer.address
        ? `<p style="color:${linkColor};font-size:0.875rem;line-height:1.6;">${footer.address.replace(/\n/g, "<br/>")}</p>`
        : `<ul class="space-y-2 list-none p-0 m-0">
        ${g.links.map(l => `<li><a href="${l.href}" class="hover:opacity-80 transition-opacity" style="color:${linkColor};text-decoration:none;font-size:0.875rem;">${l.label}</a></li>`).join("\n        ")}
      </ul>`}
    </div>`).join("\n  ");

  const addressHtml = footer.address
    ? `<div style="color:${linkColor};font-size:0.875rem;line-height:1.6;">${footer.address.replace(/\n/g, "<br/>")}</div>`
    : "";

  return `---
// Footer component — generated deterministically from live DOM computed styles
---
<footer data-section-id="shell-footer" style="background:${bg};">
  <div class="mx-auto max-w-6xl px-6 py-14">
    <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-12 mb-10">
      <!-- Brand column -->
      <div class="flex flex-col gap-4 min-w-[140px]">
        ${logoHtml}
        ${socialHtml ? `<div class="flex gap-3 text-sm">${socialHtml}</div>` : ""}
        ${addressHtml}
      </div>
      <!-- Link columns -->
      <div class="grid grid-cols-2 md:grid-cols-${Math.min(groups.length, 4)} gap-8">
        ${columnsHtml}
      </div>
    </div>
    ${footer.copyright ? `<div class="text-xs pt-6" style="color:${headingColor};border-top:1px solid ${dividerColor};">${footer.copyright}</div>` : ""}
  </div>
</footer>
`;
}

export function makeDefaultHeader(designSystem: DesignSystem | DesignSystemV2): SiteSection {
  // v1 DesignSystem still carries navLinks on the shell; v2 does not (nav links
  // now come from ExtractedNav). Access via type assertion to avoid errors on v2.
  const shellNavLinks =
    (designSystem.global.shell as { navLinks?: { label: string; href: string }[] }).navLinks ?? [];
  return {
    id: "header",
    type: "SiteHeader",
    props: {
      logo: { type: "text", value: designSystem.business.name ?? "Home" },
      navLinks: shellNavLinks,
    },
  };
}

export function makeDefaultFooter(designSystem: DesignSystem | DesignSystemV2): SiteSection {
  const year = new Date().getFullYear();
  const businessName = designSystem.business.name ?? "";
  // v1 DesignSystem still carries navLinks on the shell; v2 does not.
  const shellNavLinks =
    (designSystem.global.shell as { navLinks?: { label: string; href: string }[] }).navLinks ?? [];
  return {
    id: "footer",
    type: "SiteFooter",
    props: {
      businessName,
      navLinks: shellNavLinks,
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

function pageAstro(page: HierarchyPage, sharedIds?: Set<string>): string {
  const title = page.metaTitle ?? page.title;
  const description = page.metaDescription ?? "";
  const shared = sharedIds ?? new Set<string>();

  // De-dupe imports: multiple sections on a page may reference the same
  // shared component id and only one `import` line should be emitted.
  const seenImports = new Set<string>();
  const importLines: string[] = [];
  for (const section of page.sections) {
    if (section.sharedComponentId) {
      const id = section.sharedComponentId;
      const componentName = toComponentName(id);
      const key = `shared:${componentName}`;
      if (seenImports.has(key)) continue;
      seenImports.add(key);
      importLines.push(
        `import ${componentName} from "../components/shared/${sharedComponentFileName(id)}.astro";`,
      );
    } else {
      const componentName = toComponentName(section.id);
      const key = `section:${componentName}`;
      if (seenImports.has(key)) continue;
      seenImports.add(key);
      importLines.push(
        `import ${componentName} from "../components/sections/${section.id}.astro";`,
      );
    }
  }

  const renderedSections = page.sections
    .map((section) => {
      if (section.sharedComponentId) {
        const componentName = toComponentName(section.sharedComponentId);
        const propsInline = section.sharedProps
          ? " " +
            Object.entries(section.sharedProps)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(" ")
          : "";
        return `    <${componentName}${propsInline} />`;
      }
      const componentName = toComponentName(section.id);
      return `    <${componentName} />`;
    })
    .join("\n");

  // Silence unused-var warnings for shared imports when the component set
  // ends up not referenced on a particular page (defensive; normally not hit).
  void shared;

  return `---
import Layout from "../layouts/Layout.astro";
${importLines.join("\n")}
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
