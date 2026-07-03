import type { ExtractArtifact } from "../types/pipeline-artifacts";

export interface SearchPresencePage {
  path: string;
  metaTitle?: string;
  metaDescription?: string;
  canonical?: string;
  ogTags: Record<string, string>;
  headingOutline: Array<{ level: number; text: string }>;
  schemaTypes: string[];
  imageAltCoverage: { withAlt: number; total: number } | null;
}

export interface SearchPresence {
  version: "1";
  capturedAt: string;
  pages: SearchPresencePage[];
  sitemapPresent: boolean;
  baseline: ExtractArtifact["sourceBaseline"];
  topicFootprint: string[];
}

export const SEARCH_PRESENCE_DOC_KEY = "search-presence";
export const SEARCH_PRESENCE_DOC_TITLE = "Search presence";

export function buildSearchPresence(extract: ExtractArtifact): SearchPresence {
  return {
    version: "1",
    capturedAt: extract.extractedAt,
    pages: extract.pages.map((p) => {
      const meta = p.content.meta ?? {};
      const ogTags: Record<string, string> = {};
      for (const [k, v] of Object.entries(meta)) {
        if (k.startsWith("og:")) ogTags[k] = v;
      }
      const schemaTypes = p.content.jsonLd
        .flatMap((b) => (Array.isArray(b) ? b : [b]))
        .map((b) => {
          if (b && typeof b === "object" && "@type" in b) {
            const t = (b as { "@type"?: unknown })["@type"];
            return typeof t === "string" ? t : undefined;
          }
          return undefined;
        })
        .filter((t): t is string => typeof t === "string");
      return {
        path: p.path,
        metaTitle: meta["og:title"] ?? p.content.title,
        metaDescription: meta["description"] ?? meta["og:description"],
        canonical: meta["canonical"],
        ogTags,
        headingOutline: p.content.headings,
        schemaTypes,
        imageAltCoverage: null,
      };
    }),
    sitemapPresent: extract.siteMap.some((e) => e.source === "sitemap"),
    baseline: extract.sourceBaseline,
    topicFootprint: [
      ...new Set(
        extract.pages.flatMap((p) =>
          p.content.headings.map((h) => h.text.toLowerCase()),
        ),
      ),
    ].slice(0, 100),
  };
}

export function buildEmptySearchPresence(now: string): SearchPresence {
  return {
    version: "1",
    capturedAt: now,
    pages: [],
    sitemapPresent: false,
    baseline: {
      capturedAt: now,
      lighthouse: [],
      axe: [],
      network: [],
    },
    topicFootprint: [],
  };
}
