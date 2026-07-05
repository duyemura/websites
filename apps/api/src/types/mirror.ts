export const MIRROR_STAGES = [
  "mirror-crawl",
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
  kind: "schedule" | "blog" | "plugin";
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
}

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
}

export interface MirrorAsset {
  originalUrl: string;
  /** S3 key under the snapshot prefix */
  storageKey: string;
  /** Path used inside the rewritten site, e.g. "/_assets/ab12cd.css" */
  localPath: string;
  contentType: string;
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
