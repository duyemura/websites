// apps/api/scripts/milo-args.ts
// Exported separately so tests can import without triggering milo.ts's top-level main() call.

export type MiloCommand =
  | { cmd: "join"; url: string; theme?: "baseline" | "impact" | "beanburito"; tier: "free" | "paid"; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "upgrade"; site: string; theme?: "baseline" | "impact" | "beanburito"; verbose: boolean; force: boolean; quiet: boolean; autoFix: boolean }
  | { cmd: "rebuild"; site: string; verbose: boolean; force: boolean; quiet: boolean; autoFix: boolean }
  | { cmd: "page"; site: string; path: string; verbose: boolean; force: boolean; quiet: boolean }
  | { cmd: "eval"; site: string; path?: string; url?: string; keywords?: string[]; autoFix: boolean; verbose: boolean; quiet: boolean }
  | { cmd: "eval-fix"; site: string; evalUuid?: string; path?: string; url?: string; keywords?: string[]; verbose: boolean; quiet: boolean }
  | { cmd: "nav"; site: string; verbose: boolean; quiet: boolean }
  | { cmd: "restore"; site: string; version: number; verbose: boolean; quiet: boolean }
  | { cmd: "stages"; url?: string; site?: string; stages: string[]; tier: "free" | "paid"; templateTheme?: "baseline" | "impact" | "beanburito"; verbose: boolean; force: boolean; quiet: boolean };

export const PIPELINES = {
  join:    ["enrich", "clone", "docgen", "content"] as const,
  upgrade: ["generate", "template", "template-eval", "publish", "eval"] as const,
  rebuild: ["generate", "template", "template-eval", "publish", "eval"] as const,
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

  if (subcommand === "join") {
    const url = get("url");
    if (!url) throw new Error("milo join requires --url <url>");
    return { cmd: "join", url, theme: get("theme") as "baseline" | "impact" | "beanburito" | undefined, tier: (get("tier") ?? "free") as "free" | "paid", ...bool };
  }
  if (subcommand === "upgrade") {
    const site = get("site");
    if (!site) throw new Error("milo upgrade requires --site <uuid>");
    return { cmd: "upgrade", site, theme: get("theme") as "baseline" | "impact" | "beanburito" | undefined, autoFix: has("auto-fix"), ...bool };
  }
  if (subcommand === "rebuild") {
    const site = get("site");
    if (!site) throw new Error("milo rebuild requires --site <uuid>");
    return { cmd: "rebuild", site, autoFix: has("auto-fix"), ...bool };
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
      path: get("path") ?? "/",
      url: get("url"),
      keywords: keywords ? keywords.split(",").map((s) => s.trim()) : undefined,
      autoFix: has("auto-fix"),
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
    if (!evalUuid && !path) {
      throw new Error("milo eval-fix requires --eval-uuid <uuid> or --path /slug");
    }
    return {
      cmd: "eval-fix",
      site,
      evalUuid,
      path,
      url,
      keywords: keywords ? keywords.split(",").map((s) => s.trim()) : undefined,
      ...bool,
    };
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
    `  milo join    --url <url> [--theme x] [--tier free|paid]\n` +
    `  milo upgrade --site <uuid> [--theme x] [--auto-fix]\n` +
    `  milo rebuild --site <uuid> [--auto-fix]\n` +
    `  milo page    --site <uuid> --path /slug\n` +
    `  milo eval    --site <uuid> [--path /slug] [--url <url>] [--keywords k1,k2] [--auto-fix]\n` +
    `  milo eval-fix --site <uuid> --eval-uuid <uuid> | --path /slug [--url <url>] [--keywords k1,k2]\n` +
    `  milo nav     --site <uuid>\n` +
    `  milo restore --site <uuid> --version <n>\n` +
    `  milo --url <url> --stages s1,s2  (legacy)`,
  );
}
