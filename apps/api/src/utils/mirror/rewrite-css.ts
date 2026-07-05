// Matches url() with single-quoted, double-quoted, or unquoted content.
// Separate capture groups allow quoted URLs to contain ) without truncation. (I6)
const URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")]+))\s*\)/g;

// Matches bare @import "..." or @import '...' (no url() wrapper).
// url()-wrapped imports are already handled by URL_RE. (I1/task8)
const BARE_IMPORT_RE = /@import\s+['"]([^'"]+)['"]/g;

function resolve(ref: string, baseUrl: string): string | null {
  if (ref.startsWith("data:") || ref.startsWith("#")) return null;
  try {
    return new URL(ref, baseUrl).toString();
  } catch {
    return null;
  }
}

function refFromMatch(match: RegExpExecArray): string | null {
  // Groups: 1=single-quoted, 2=double-quoted, 3=unquoted
  return match[1] ?? match[2] ?? match[3] ?? null;
}

export function extractCssUrls(css: string, baseUrl: string): string[] {
  const out = new Set<string>();

  for (const match of css.matchAll(URL_RE)) {
    const ref = refFromMatch(match);
    if (!ref) continue;
    const abs = resolve(ref, baseUrl);
    if (abs) out.add(abs);
  }

  for (const match of css.matchAll(BARE_IMPORT_RE)) {
    const ref = match[1];
    if (!ref) continue;
    const abs = resolve(ref, baseUrl);
    if (abs) out.add(abs);
  }

  return [...out];
}

export function rewriteCssUrls(
  css: string,
  baseUrl: string,
  assetMap: Map<string, string>,
): string {
  // Rewrite url() references
  let result = css.replace(URL_RE, (full, single: string | undefined, double: string | undefined, unquoted: string | undefined) => {
    const ref = single ?? double ?? unquoted;
    if (!ref) return full;
    const abs = resolve(ref, baseUrl);
    if (!abs) return full;
    const mapped = assetMap.get(abs);
    if (!mapped) return full;
    // Preserve original quote style
    if (single !== undefined) return `url('${mapped}')`;
    if (double !== undefined) return `url("${mapped}")`;
    return `url('${mapped}')`;
  });

  // Rewrite bare @import "..." references
  result = result.replace(BARE_IMPORT_RE, (full, ref: string | undefined) => {
    if (!ref) return full;
    const abs = resolve(ref, baseUrl);
    if (!abs) return full;
    const mapped = assetMap.get(abs);
    return mapped ? `@import "${mapped}"` : full;
  });

  return result;
}
