export const MIRROR_STAGES = [
  "crawl",
  "mirror-assets",
  "mirror-snapshot",
  "mirror-deploy",
] as const;
export type MirrorStage = (typeof MIRROR_STAGES)[number];

export interface MirrorForm {
  formId: string;
  originalAction: string;
  method: string;
  /** CSS selector uniquely identifying this form in the page, e.g. "form:nth-of-type(2)" */
  selector: string;
}

export interface DynamicRegion {
  kind: "schedule" | "blog" | "plugin" | "booking-widget";
  selector: string;
  /** Human-readable evidence for why this was flagged */
  evidence: string;
}

export interface MirrorPage {
  /** Absolute original URL */
  url: string;
  /** Normalized path, e.g. "/" or "/coaches" */
  path: string;
  title: string;
  /** S3 key where the raw rendered HTML is stored */
  htmlKey: string;
  forms: MirrorForm[];
  dynamicRegions: DynamicRegion[];
  /** Third-party hosts referenced by script/iframe tags */
  embeds: string[];
  /** UGC pages are discovered (in registry, in redirect map) but not captured on free tier */
  category: "structural" | "ugc";
}

// ---- Tier configuration ----

/**
 * Free tier: 20 structural pages captured; UGC discovered but not rendered.
 * Paid tier: no cap, all pages captured.
 * Pass CRAWL_TIER_PAID to crawlSite for unlimited capture.
 */
export interface CrawlTier {
  /** Maximum number of pages to capture (render + store HTML). Infinity = no cap. */
  maxCapturedPages: number;
  /** Whether to skip rendering UGC pages (blog posts, recipes, etc.). Structural index pages are always captured. */
  skipUgcCapture: boolean;
}

export const CRAWL_TIER_FREE: CrawlTier = {
  maxCapturedPages: 20,
  skipUgcCapture: true,
};

export const CRAWL_TIER_PAID: CrawlTier = {
  maxCapturedPages: Infinity,
  skipUgcCapture: false,
};

export interface MirrorRedirect {
  from: string;
  to: string;
  status: number;
}

export interface MirrorCrawlArtifact {
  sourceUrl: string;
  origin: string;
  pages: MirrorPage[];
  redirects: MirrorRedirect[];
  sitemapXml: string | null;
  robotsTxt: string | null;
  failures: { url: string; reason: string }[];
  /** UGC paths discovered but not captured on the free tier (blog posts, recipes, etc.).
   *  Included in the redirect map so old URLs don't 404 after cutover. */
  ugcRegistry: string[];
}

export interface AssetAppearance {
  /** Absolute original URL of the asset. */
  originalUrl: string;
  /** Normalized page path where the asset appeared, e.g. "/" or "/programs" */
  pagePath: string;
  /** Detected section type from class/heading, e.g. "hero", "program", "blog" */
  sectionType: string;
  /** First heading in the containing section, if any. */
  sectionHeading?: string;
  /** First meaningful paragraph in the containing section, if any. */
  sectionBody?: string;
}

export interface MirrorAsset {
  originalUrl: string;
  /** S3 key under the snapshot prefix */
  storageKey: string;
  /** Path used inside the rewritten site, e.g. "/_assets/ab12cd.css" */
  localPath: string;
  contentType: string;
  /** Image dimensions, when the asset is a raster image and we were able to read them. */
  width?: number;
  height?: number;
  /** Every page/section where this asset was found during crawl. */
  appearances?: AssetAppearance[];
  /** Vision-generated content tags for matching to generated sections. */
  visionTags?: string[];
  /** Vision-generated natural-language description. */
  visionDescription?: string;
  /** Vision-generated contexts where this image fits, e.g. ["blog", "nutrition"]. */
  visionContexts?: string[];
  /** Short vision subject, e.g. "pizza close-up". */
  visionSubject?: string;
  /** Vision confidence 0-1. */
  visionConfidence?: number;
}

export interface MirrorAssetsArtifact {
  assets: MirrorAsset[];
  failures: { url: string; reason: string }[];
}

export interface MirrorSnapshotArtifact {
  /** S3 prefix: sites/{siteUuid}/snapshots/{version}/ */
  s3Prefix: string;
  pages: { path: string; htmlKey: string }[];
  redirects: MirrorRedirect[];
  assetCount: number;
  warnings: string[];
}

export const TRANSFORM_TYPES = [
  "meta-set",
  "jsonld-inject",
  "head-inject",
  "text-replace",
  "attr-set",
  "form-route",
  "page-replace",
] as const;
export type TransformType = (typeof TRANSFORM_TYPES)[number];

export interface SiteTransformRecord {
  uuid: string;
  ordinal: number;
  type: TransformType;
  pageGlob: string;
  selector: string | null;
  payload: unknown;
  status: "active" | "stale" | "disabled";
}
