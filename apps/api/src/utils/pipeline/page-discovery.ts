export type PageClassification = "structural" | "collection-exemplar" | "ugc-instance" | "boilerplate";

export interface SiteMapEntry {
  url: string;
  path: string;
  title: string;
  classification: PageClassification;
  source: "sitemap" | "nav" | "footer" | "link-sweep";
  status: "captured" | "skipped";
  skipReason?: string;
}

export interface DiscoveryInputs {
  baseUrl: string;
  sitemapUrls: string[];
  navLinks: { label: string; href: string }[];
  footerLinks: { label: string; href: string }[];
  sweepLinks: string[];
  pageTitles: Record<string, string>;
}

const BOILERPLATE_RE = /(privacy|terms|cookie|legal|accessibility-statement)/i;
const UGC_PATH_RE = /\/(blog|news|articles?|events?|posts?)\/.+/i;
const DATED_URL_RE = /\/\d{4}\/\d{2}\//;
const COLLECTION_MIN_CHILDREN = 4;

export function detectCollections(paths: string[]): string[] {
  const childCounts = new Map<string, number>();
  for (const p of paths) {
    const segments = p.split("/").filter(Boolean);
    if (segments.length < 2) continue;
    const prefix = `/${segments[0]}/`;
    childCounts.set(prefix, (childCounts.get(prefix) ?? 0) + 1);
  }
  return [...childCounts.entries()]
    .filter(([prefix, count]) => count >= COLLECTION_MIN_CHILDREN && UGC_PATH_RE.test(`${prefix}x`))
    .map(([prefix]) => prefix);
}

export function classifyUrl(
  path: string,
  opts: { collectionPrefixes: string[] },
): PageClassification {
  if (BOILERPLATE_RE.test(path)) return "boilerplate";
  if (opts.collectionPrefixes.some((prefix) => path.startsWith(prefix) && path !== prefix.slice(0, -1))) {
    return "ugc-instance";
  }
  if (DATED_URL_RE.test(path)) return "ugc-instance";
  return "structural";
}

function normalizePath(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    if (new URL(baseUrl).origin !== url.origin) return null;
    let path = url.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return path;
  } catch {
    return null;
  }
}

export function buildSiteMap(
  inputs: DiscoveryInputs,
  opts: { maxPages: number },
): SiteMapEntry[] {
  // Rank: nav > footer > sitemap > sweep. First source wins on dedup.
  const ranked: Array<{ path: string; source: SiteMapEntry["source"] }> = [];
  const seen = new Set<string>();
  const push = (href: string, source: SiteMapEntry["source"]) => {
    const path = normalizePath(href, inputs.baseUrl);
    if (!path || seen.has(path)) return;
    seen.add(path);
    ranked.push({ path, source });
  };

  push("/", "nav");
  for (const l of inputs.navLinks) push(l.href, "nav");
  for (const l of inputs.footerLinks) push(l.href, "footer");
  for (const u of inputs.sitemapUrls) push(u, "sitemap");
  for (const u of inputs.sweepLinks) push(u, "link-sweep");

  const collectionPrefixes = detectCollections(ranked.map((r) => r.path));

  let captured = 0;
  const exemplarTaken = new Set<string>();
  return ranked.map(({ path, source }) => {
    const base: Omit<SiteMapEntry, "classification" | "status"> = {
      url: new URL(path, inputs.baseUrl).toString(),
      path,
      title: inputs.pageTitles[path] ?? "",
      source,
    };
    let classification = classifyUrl(path, { collectionPrefixes });

    if (classification === "ugc-instance") {
      const prefix = collectionPrefixes.find((p) => path.startsWith(p));
      if (prefix && !exemplarTaken.has(prefix)) {
        exemplarTaken.add(prefix);
        classification = "collection-exemplar";
      }
    }

    const capturable = classification === "structural" || classification === "collection-exemplar";
    if (capturable && captured < opts.maxPages) {
      captured += 1;
      return { ...base, classification, status: "captured" as const };
    }
    return {
      ...base,
      classification,
      status: "skipped" as const,
      skipReason:
        classification === "ugc-instance" ? "user-generated-content"
        : classification === "boilerplate" ? "boilerplate"
        : "page-cap-exceeded",
    };
  });
}
