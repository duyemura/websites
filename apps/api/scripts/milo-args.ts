// apps/api/scripts/milo-args.ts
// Exported separately so tests can import without triggering milo.ts's top-level main() call.
import { TEMPLATE_THEMES } from "@milo/shared-types";

export type MiloCommand =
  | { cmd: "new"; url: string; theme?: "baseline" | "impact" | "beanburito"; tier: "free" | "paid"; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "upgrade"; site: string; theme?: "baseline" | "impact" | "beanburito"; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "rebuild"; site: string; theme?: "baseline" | "impact" | "beanburito"; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "page"; site: string; path: string; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "eval"; site: string; path?: string; url?: string; keywords?: string[]; verbose: boolean; quiet: boolean }
  | { cmd: "eval-fix"; site?: string; evalUuid?: string; path?: string; url?: string; keywords?: string[]; verbose: boolean; quiet: boolean; scoreThreshold?: number; maxLoops?: number }
  | { cmd: "publish"; site: string; verbose: boolean; quiet: boolean }
  | { cmd: "nav"; site: string; verbose: boolean; quiet: boolean }
  | { cmd: "restore"; site: string; version: number; verbose: boolean; quiet: boolean }
  | { cmd: "stages"; url?: string; site?: string; stages: string[]; tier: "free" | "paid"; templateTheme?: "baseline" | "impact" | "beanburito"; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "template"; url: string; name: string; stages?: string[]; verbose: boolean; force: boolean; quiet: boolean };

export const PIPELINES = {
  // Build pipelines stage to staging only. Publishing to production is a
  // separate explicit `milo publish --site <uuid>` step.
  new:     ["enrich", "crawl", "docgen", "content", "generate", "template", "template-eval", "eval"] as const,
  upgrade: ["generate", "template", "template-eval", "eval"] as const,
  rebuild: ["generate", "template", "template-eval", "eval"] as const,
  template: ["extract", "segment", "contract", "synthesize", "component-eval"] as const,
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
    return { cmd: "new", url, theme: (get("theme") ?? "beanburito") as "baseline" | "impact" | "beanburito", tier: (get("tier") ?? "free") as "free" | "paid", ...bool };
  }
  if (subcommand === "upgrade") {
    const site = get("site");
    if (!site) throw new Error("milo upgrade requires --site <uuid>");
    // Default upgrades to beanburito unless an explicit theme is requested.
    return { cmd: "upgrade", site, theme: (get("theme") ?? "beanburito") as "baseline" | "impact" | "beanburito", ...bool };
  }
  if (subcommand === "rebuild") {
    const site = get("site");
    if (!site) throw new Error("milo rebuild requires --site <uuid>");
    return { cmd: "rebuild", site, theme: get("theme") as "baseline" | "impact" | "beanburito" | undefined, ...bool };
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
    return { cmd: "template", url, name, stages, ...bool };
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
      templateTheme: get("theme") as "baseline" | "impact" | "beanburito" | undefined,
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
    `  milo template --url <url> --name <templatename>\n` +
    `  milo --url <url> --stages s1,s2  (legacy)`,
  );
}
