const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

function resolve(ref: string, baseUrl: string): string | null {
  if (ref.startsWith("data:") || ref.startsWith("#")) return null;
  try {
    return new URL(ref, baseUrl).toString();
  } catch {
    return null;
  }
}

export function extractCssUrls(css: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const match of css.matchAll(URL_RE)) {
    const ref = match[2];
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
  return css.replace(URL_RE, (full, _quote, ref: unknown) => {
    if (typeof ref !== "string") return full;
    const abs = resolve(ref, baseUrl);
    if (!abs) return full;
    const mapped = assetMap.get(abs);
    return mapped ? `url('${mapped}')` : full;
  });
}
