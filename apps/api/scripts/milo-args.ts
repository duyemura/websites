// apps/api/scripts/milo-args.ts
// Exported separately so tests can import without triggering milo.ts's top-level main() call.
import { TEMPLATE_THEMES } from "@milo/shared-types";

export type TemplateTheme = (typeof TEMPLATE_THEMES)[number];

export type MiloCommand =
  | { cmd: "new"; url: string; theme?: TemplateTheme; tier: "free" | "paid"; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "upgrade"; site: string; theme?: TemplateTheme; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "rebuild"; site: string; theme?: TemplateTheme; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "page"; site: string; path: string; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "eval"; site: string; path?: string; url?: string; keywords?: string[]; verbose: boolean; quiet: boolean }
  | { cmd: "eval-fix"; site?: string; evalUuid?: string; path?: string; url?: string; keywords?: string[]; verbose: boolean; quiet: boolean; scoreThreshold?: number; maxLoops?: number }
  | { cmd: "publish"; site: string; verbose: boolean; quiet: boolean }
  | { cmd: "nav"; site: string; verbose: boolean; quiet: boolean }
  | { cmd: "restore"; site: string; version: number; verbose: boolean; quiet: boolean }
  | { cmd: "stages"; url?: string; site?: string; stages: string[]; tier: "free" | "paid"; templateTheme?: TemplateTheme; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "template"; url: string; name: string; theme?: TemplateTheme; group?: "content" | "design"; stages?: string[]; awsProfile?: string; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "template-eval"; name: string; component?: string; verbose: boolean; quiet: boolean }
  | { cmd: "template-fix"; url: string; name: string; fix?: string; auto: boolean; maxLoops: number; theme?: TemplateTheme; awsProfile?: string; deploy: boolean; verbose: boolean; quiet: boolean };

export const PIPELINES = {
  // Build pipelines stage to staging only. Publishing to production is a
  // separate explicit `milo publish --site <uuid>` step.
  new:     ["enrich", "crawl", "docgen", "content", "generate", "template", "template-eval", "eval"] as const,
  upgrade: ["generate", "template", "template-eval", "eval"] as const,
  rebuild: ["generate", "template", "template-eval", "eval"] as const,
  template: ["extract", "segment", "contract", "spec-audit", "synthesize", "section-extract", "adapt", "add-component", "component-eval", "generate", "template"] as const,
} as const;

/**
 * Named stage groups for `milo template <group>`.
 *
 * content  — refresh gym data from the source site (crawl → docgen → generate).
 *            Use when the source site's content has changed.
 *
 * design   — rebuild the visual template (extract → segment → contract →
 *            section-extract → adapt → template). Use when you've changed
 *            Astro components or want fresh component extraction from the source.
 *
 * (no group) — full rebuild: content then design.
 */
// Template sources are design fixtures (fake demo sites), not real businesses.
// enrich (GMB lookup) only belongs in the join/upgrade/rebuild pipelines for
// actual gym sign-ups — never in the template pipeline.
export const TEMPLATE_GROUPS = {
  content: ["crawl", "docgen", "content", "generate"],
  design:  ["extract", "segment", "contract", "section-extract", "adapt", "template"],
  full:    ["crawl", "docgen", "content", "generate", "extract", "segment", "contract", "section-extract", "adapt", "template"],
} as const;

export function parseArgs(): MiloCommand {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const get = (flag: string) => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
  };
  const has = (flag: string) => argv.includes(`--${flag}`);
  const bool = { verbose: has("verbose"), force: has("force"), quiet: has("quiet") };

  if (subcommand === "new") {
    const url = get("url");
    if (!url) throw new Error("milo new requires --url <url>");
    // Default new sites to the beanburito template; override with --theme.
    return { cmd: "new", url, theme: (get("theme") ?? "beanburito") as TemplateTheme, tier: (get("tier") ?? "free") as "free" | "paid", ...bool };
  }
  if (subcommand === "upgrade") {
    const site = get("site");
    if (!site) throw new Error("milo upgrade requires --site <uuid>");
    // Default upgrades to beanburito unless an explicit theme is requested.
    return { cmd: "upgrade", site, theme: (get("theme") ?? "beanburito") as TemplateTheme, ...bool };
  }
  if (subcommand === "rebuild") {
    const site = get("site");
    if (!site) throw new Error("milo rebuild requires --site <uuid>");
    return { cmd: "rebuild", site, theme: get("theme") as TemplateTheme | undefined, ...bool };
  }
  if (subcommand === "page") {
    const site = get("site");
    const path = get("path");
    if (!site) throw new Error("milo page requires --site <uuid>");
    if (!path) throw new Error("milo page requires --path /slug");
    return { cmd: "page", site, path, ...bool };
  }
  if (subcommand === "eval") {
    const site = get("site");
    if (!site) throw new Error("milo eval requires --site <uuid>");
    const keywords = get("keywords");
    return {
      cmd: "eval",
      site,
      path: get("path"),
      url: get("url"),
      keywords: keywords ? keywords.split(",").map((s) => s.trim()) : undefined,
      ...bool,
    };
  }
  if (subcommand === "eval-fix") {
    const site = get("site");
    if (!site) throw new Error("milo eval-fix requires --site <uuid>");
    const evalUuid = get("eval-uuid");
    const path = get("path");
    const url = get("url");
    const keywords = get("keywords");
    const scoreThresholdStr = get("score-threshold");
    const maxLoopsStr = get("max-loops");
    return {
      cmd: "eval-fix",
      site,
      evalUuid,
      path,
      url,
      keywords: keywords ? keywords.split(",").map((s) => s.trim()) : undefined,
      scoreThreshold: scoreThresholdStr ? Number(scoreThresholdStr) : undefined,
      maxLoops: maxLoopsStr ? Number(maxLoopsStr) : undefined,
      ...bool,
    };
  }
  if (subcommand === "publish") {
    const site = get("site");
    if (!site) throw new Error("milo publish requires --site <uuid>");
    return { cmd: "publish", site, ...bool };
  }
  if (subcommand === "nav") {
    const site = get("site");
    if (!site) throw new Error("milo nav requires --site <uuid>");
    return { cmd: "nav", site, ...bool };
  }
  if (subcommand === "restore") {
    const site = get("site");
    const versionStr = get("version");
    if (!site) throw new Error("milo restore requires --site <uuid>");
    if (!versionStr) throw new Error("milo restore requires --version <n>");
    const version = Number(versionStr);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`milo restore --version must be a positive integer, got: "${versionStr}"`);
    }
    return { cmd: "restore", site, version, ...bool };
  }

  if (subcommand === "template") {
    // Optional positional group: `milo template content` or `milo template design`
    // The group word sits at argv[1] (before any flags).
    const GROUPS = ["content", "design"] as const;
    const groupArg = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
    const group = GROUPS.includes(groupArg as typeof GROUPS[number]) ? groupArg as "content" | "design" : undefined;

    const url = get("url");
    const name = get("name");
    if (!url) throw new Error("milo template requires --url <url>");
    if (!name) throw new Error("milo template requires --name <templatename>");
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error("--name must be lowercase letters, numbers, and hyphens only");
    }
    if (!bool.force && (TEMPLATE_THEMES as readonly string[]).includes(name)) {
      throw new Error(`--name "${name}" conflicts with an existing template. Use --force to re-run the pipeline for this template.`);
    }
    const stagesStr = get("stages");
    const stages = stagesStr ? stagesStr.split(",").map((s) => s.trim()) : undefined;
    return { cmd: "template", url, name, theme: get("theme") as TemplateTheme | undefined, group, stages, awsProfile: get("aws-profile"), ...bool };
  }

  if (subcommand === "template-eval") {
    const name = get("name");
    if (!name) throw new Error("milo template-eval requires --name <templatename>");
    return { cmd: "template-eval", name, component: get("component"), ...bool };
  }

  if (subcommand === "template-fix") {
    const url = get("url");
    const name = get("name");
    const fix = get("fix");
    if (!url)  throw new Error("milo template-fix requires --url <url>");
    if (!name) throw new Error("milo template-fix requires --name <templatename>");
    const auto = has("auto");
    if (!fix && !auto) throw new Error("milo template-fix requires --fix \"description\" or --auto");
    const maxLoopsStr = get("max-loops");
    return {
      cmd: "template-fix",
      url,
      name,
      fix: fix ?? undefined,
      auto,
      maxLoops: maxLoopsStr ? parseInt(maxLoopsStr, 10) : 5,
      theme: get("theme") as TemplateTheme | undefined,
      awsProfile: get("aws-profile"),
      deploy: has("deploy"),
      ...bool,
    };
  }

  // Legacy --stages escape hatch
  const stagesStr = get("stages");
  const url = get("url");
  const site = get("site");
  if (stagesStr && (url || site)) {
    return {
      cmd: "stages",
      stages: stagesStr.split(",").map((s) => s.trim()),
      url, site,
      tier: (get("tier") ?? "free") as "free" | "paid",
      templateTheme: get("theme") as TemplateTheme | undefined,
      ...bool,
    };
  }

  throw new Error(
    `Unknown command: "${subcommand ?? "(none)"}"\n` +
    `Usage:\n` +
    `  milo new      --url <url> [--theme x] [--tier free|paid]\n` +
    `  milo upgrade  --site <uuid> [--theme x]\n` +
    `  milo rebuild  --site <uuid> [--theme x]\n` +
    `  milo publish  --site <uuid>\n` +
    `  milo page     --site <uuid> --path /slug\n` +
    `  milo eval     --site <uuid> [--path /slug] [--url <url>] [--keywords k1,k2]\n` +
    `  milo eval-fix --site <uuid> [--eval-uuid <uuid>] [--path /slug] [--url <url>] [--keywords k1,k2] [--score-threshold 70] [--max-loops 10]\n` +
    `  milo nav      --site <uuid>\n` +
    `  milo restore  --site <uuid> --version <n>\n` +
    `  milo template         --url <url> --name <name> [--theme x]           full rebuild (content + design)\n` +
    `  milo template content --url <url> --name <name> [--theme x]           refresh gym data only\n` +
    `  milo template design  --url <url> --name <name> [--theme x]           rebuild visual template only\n` +
    `  milo template         --url <url> --name <name> --stages s1,s2        surgical: specific stages\n` +
    `  milo template-fix     --url <url> --name <name> --fix \"description\" [--deploy]       targeted fix\n` +
    `  milo template-fix     --url <url> --name <name> --auto [--max-loops 5] [--deploy]  auto diagnose+fix loop\n` +
    `  milo template-eval    --name <name> [--component <ComponentName>]\n` +
    `  milo --url <url> --stages s1,s2  (legacy)`,
  );
}
