import type { Kysely } from "kysely";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { SiteBlueprint } from "../utils/site-blueprint";
import type { SiteSection } from "@ploy-gyms/shared-types";
import { renderSectionComponent } from "../utils/section-component-registry";
import { uploadBuildArtifacts } from "../utils/build-artifacts";

export interface GeneratePageInput {
  db: Kysely<DB>;
  config: Config;
  workspaceUuid: string;
  siteUuid: string;
  pageSlug: string;
  blueprint: SiteBlueprint;
  mode: "replication" | "template" | "greenfield";
  attemptId: string;
  priorIssues?: QaIssue[];
}

export interface QaIssue {
  component_id: string;
  category: string;
  severity: "high" | "medium" | "low";
  description: string;
  suggested_fix: string;
}

export interface GeneratePageOutput {
  attemptId: string;
  sourceDir: string;
  distDir: string;
  previewUrl: string;
  pageSections: SiteSection[];
  metaTitle: string;
  metaDescription: string;
  buildSuccess: boolean;
  buildLog?: string;
}

const ASTRO_VERSION = "^5.1.5";
const TAILWIND_INTEGRATION_VERSION = "^5.1.3";
const TAILWIND_VERSION = "3";

export async function generateAstroPage(input: GeneratePageInput): Promise<GeneratePageOutput> {
  const { config, workspaceUuid, siteUuid, pageSlug, blueprint, attemptId } = input;
  const page = blueprint.pages.find((p) => p.slug === pageSlug);
  if (!page) {
    throw new Error(`Page ${pageSlug} not found in blueprint`);
  }

  const sourceDir = path.join(os.tmpdir(), "ploy-gyms-build", siteUuid, attemptId, pageSlug);
  const distDir = path.join(sourceDir, "dist");

  await rm(sourceDir, { recursive: true, force: true });
  await mkdir(sourceDir, { recursive: true });

  await writeProjectFiles(sourceDir, blueprint, page);

  const installResult = await runCommand("pnpm", ["install"], sourceDir);
  if (installResult.exitCode !== 0) {
    return {
      attemptId,
      sourceDir,
      distDir,
      previewUrl: "",
      pageSections: page.sections,
      metaTitle: page.metaTitle ?? page.title,
      metaDescription: page.metaDescription ?? "",
      buildSuccess: false,
      buildLog: `pnpm install failed:\n${installResult.output}`,
    };
  }

  const buildResult = await runCommand("pnpm", ["exec", "astro", "build"], sourceDir);
  if (buildResult.exitCode !== 0) {
    return {
      attemptId,
      sourceDir,
      distDir,
      previewUrl: "",
      pageSections: page.sections,
      metaTitle: page.metaTitle ?? page.title,
      metaDescription: page.metaDescription ?? "",
      buildSuccess: false,
      buildLog: `astro build failed:\n${buildResult.output}`,
    };
  }

  const { previewUrl } = await uploadBuildArtifacts({
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
    previewUrl,
    pageSections: page.sections,
    metaTitle: page.metaTitle ?? page.title,
    metaDescription: page.metaDescription ?? "",
    buildSuccess: true,
    buildLog: buildResult.output,
  };
}

async function writeProjectFiles(
  sourceDir: string,
  blueprint: SiteBlueprint,
  page: SiteBlueprint["pages"][number],
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
  await writeFile(path.join(sourceDir, "src", "styles", "tokens.css"), tokensCss(blueprint.design_tokens));
  await writeFile(path.join(sourceDir, "src", "layouts", "Layout.astro"), layoutAstro(blueprint));
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Header.astro"),
    renderSectionComponent(blueprint.global_shell.header ?? makeDefaultHeader(blueprint)),
  );
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Footer.astro"),
    renderSectionComponent(blueprint.global_shell.footer ?? makeDefaultFooter(blueprint)),
  );

  for (const section of page.sections) {
    await writeFile(
      path.join(sourceDir, "src", "components", "sections", `${section.id}.astro`),
      renderSectionComponent(section),
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

function tokensCss(tokens: SiteBlueprint["design_tokens"]): string {
  return `:root {
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

function layoutAstro(blueprint: SiteBlueprint): string {
  const businessName = blueprint.site_metadata.business_name ?? "Ploy for gyms";
  return `---
import Header from "../components/shared/Header.astro";
import Footer from "../components/shared/Footer.astro";

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
    <link rel="stylesheet" href="/styles/tokens.css" />
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

function makeDefaultHeader(blueprint: SiteBlueprint): import("@ploy-gyms/shared-types").SiteSection {
  return {
    id: "header",
    type: "SiteHeader",
    props: {
      logo: { type: "text", value: blueprint.site_metadata.business_name ?? "Home" },
      navLinks: blueprint.global_shell.navLinks ?? [],
    },
  };
}

function makeDefaultFooter(blueprint: SiteBlueprint): import("@ploy-gyms/shared-types").SiteSection {
  const year = new Date().getFullYear();
  const businessName = blueprint.site_metadata.business_name ?? "";
  return {
    id: "footer",
    type: "SiteFooter",
    props: {
      businessName,
      navLinks: blueprint.global_shell.navLinks ?? [],
      copyright: businessName ? `© ${year} ${businessName}. All rights reserved.` : `© ${year}`,
    },
  };
}

function toIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_$]/g, "_").replace(/^(?=[0-9])/, "_");
}

function pageAstro(page: SiteBlueprint["pages"][number]): string {
  const title = page.metaTitle ?? page.title;
  const description = page.metaDescription ?? "";
  const imports = page.sections
    .map((section) => {
      const id = toIdentifier(section.id);
      return `import ${id} from "../components/sections/${section.id}.astro";`;
    })
    .join("\n");

  const renderedSections = page.sections
    .map((section) => {
      const id = toIdentifier(section.id);
      return `    <${id} />`;
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
