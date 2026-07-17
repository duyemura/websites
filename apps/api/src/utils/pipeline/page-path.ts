/**
 * Normalize crawled page paths to canonical template paths.
 *
 * Reference sites are often hosted on subpaths (e.g. GitHub Pages). The
 * template-authoring pipeline must strip the deployment base so that the
 * generated spec declares logical routes like /about, not
 * /pushpress-site-modern/about.
 */

export function normalizeBasePathname(pathname: string): string {
  return pathname.replace(/\/[^/]*\.html?$/i, "").replace(/\/?$/, "/") || "/";
}

export function normalizePagePath(pagePath: string, basePathname: string): string {
  const base = normalizeBasePathname(basePathname);
  let normalized = pagePath;
  if (base !== "/" && normalized.startsWith(base)) {
    normalized = normalized.slice(base.length - 1); // keep leading slash
  }
  normalized = normalized.replace(/\/index\.html$/i, "/").replace(/\.html$/i, "");
  if (normalized === "" || normalized === "/") return "/";
  return normalized.replace(/\/$/, "");
}
