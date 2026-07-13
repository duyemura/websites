import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";

import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type {
  HierarchyPage,
  HierarchySection,
  SiteHierarchy,
} from "../../types/site-hierarchy";
import type {
  SectionVisualEvidence,
  SectionVisualEvidenceRow,
} from "../../types/section-visual-evidence";
import {
  loadSiteHierarchyDoc,
  saveSiteHierarchyDoc,
  updatePageStatus,
} from "../../utils/site-hierarchy-io";
import { loadDesignSystemDoc } from "../../utils/design-system-io";
import { loadSectionVisualEvidenceDoc } from "../../utils/section-visual-evidence-io";
import {
  saveArtifact,
  loadArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";
import { uploadPipelineImage } from "../../utils/pipeline/s3-upload";
import { imageUrlToDataUri, type S3Context } from "../../utils/pipeline/image-to-data-url";
import {
  renderVisualBlock,
  renderVisualBlockWithFlag,
  renderFallbackBlock,
} from "../visual-section-renderer";
import {
  writeProjectScaffold,
  writePageFiles,
  sharedComponentFileName,
  relativizeAssetPaths,
  inlineCssIntoHtml,
  renderNavComponent,
  makeDefaultHeader,
  makeDefaultFooter,
} from "../astro-code-generator";
import { renderSemanticSection } from "../../utils/section-component-registry";
import type { ExtractedNav, ExtractArtifact, ExtractPage, NavLink } from "../../types/pipeline-artifacts";
import { mkdir, writeFile, stat } from "node:fs/promises";

export type BuildLogCategory =
  | "consistency"
  | "seo"
  | "accessibility"
  | "performance"
  | "semantics";

export interface BuildLogEntry {
  category: BuildLogCategory;
  description: string;
  page?: string;
}

export interface BuildStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  /** Optional scope: only build these page slugs. Defaults to
   *  `hierarchy.buildPlan.buildOrder`. */
  pages?: string[];
  /** Optional override for the output source dir; primarily for tests. */
  sourceDir?: string;
  /** Whether to run `pnpm install` + `astro build` after writing source files,
   *  producing a `dist/` for the verify stage. Defaults to false for backwards
   *  compatibility with tests that don't have real Astro scaffolds; production
   *  pipeline runs (eval harness, HTTP worker) should set this to true. */
  runAstroBuild?: boolean;
  /** Whether to run `astro check` as a post-pass. Defaults to false (opt-in)
   *  because it requires the Astro project to have `node_modules` installed.
   *  Callers that install deps first can set this true. */
  runAstroCheck?: boolean;
  /** Optional progress callback so the worker can stream SSE events during a
   *  long-running build. */
  onProgress?: (payload: { stage: string; message: string; detail?: Record<string, unknown> }) => void;
  /** Optional callback for each line of subprocess output (pnpm install, astro build, etc.). */
  onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
}

export interface BuildLogLine {
  stream: "stdout" | "stderr";
  line: string;
  at: string;
}

export interface BuildStageResult {
  builtPages: string[];
  sharedComponentsBuilt: string[];
  buildLog: BuildLogEntry[];
  fallbacks: Array<{ sectionId: string; page: string }>;
  sourceDir: string;
  /** Public URL of the deployed site root, e.g. https://cdn.../sites/{uuid}/
   *  Null when runAstroBuild was false or deployment was skipped. */
  deployUrl: string | null;
  /** Raw subprocess output captured during the build stage. */
  rawLines: BuildLogLine[];
}

/** Stale design-system docs may be missing siteMetadata. Fall back to the
 *  canonical sites.mode column so replication/template/greenfield gating keeps
 *  working for older records. */
async function loadSiteMode(
  db: Kysely<DB>,
  siteUuid: string,
): Promise<"replication" | "template" | "greenfield" | undefined> {
  const site = await db
    .selectFrom("sites")
    .select("mode")
    .where("uuid", "=", siteUuid)
    .executeTakeFirst();
  const mode = site?.mode;
  if (
    mode === "replication" ||
    mode === "template" ||
    mode === "greenfield"
  ) {
    return mode;
  }
  return undefined;
}

function designSystemWithMode(
  designSystem: DesignSystemV2,
  mode: "replication" | "template" | "greenfield",
): DesignSystemV2 {
  if (designSystem.siteMetadata?.mode) return designSystem;
  return {
    ...designSystem,
    siteMetadata: {
      ...(designSystem.siteMetadata ?? {}),
      framework: "astro",
      mode,
      generatedAt: new Date().toISOString(),
    } as DesignSystemV2["siteMetadata"],
  };
}

interface AstroCheckError {
  file: string;
  message: string;
}


function getEvidenceForSection(
  visualEvidence: SectionVisualEvidence | null,
  section: HierarchySection,
): SectionVisualEvidenceRow | undefined {
  return visualEvidence?.rows.find(
    (row) => row.evidenceId === section.evidenceId,
  );
}


/**
 * Media re-hosting pre-pass: downloads every mediaUrls entry across the
 * hierarchy pages, uploads to S3 under the pipeline build prefix, and rewrites
 * the URL in-place. Failed downloads are skipped with a build-log warning.
 * Returns the log entries appended.
 */
type RehostResult = {
  log: BuildLogEntry[];
  /** original URL → re-hosted URL, for post-render substitution in generated code */
  urlMap: Map<string, string>;
};

export async function rehostMedia(
  hierarchy: SiteHierarchy,
  input: {
    s3: S3Client;
    config: Config;
    workspaceUuid: string;
    siteUuid: string;
  },
): Promise<RehostResult> {
  const log: BuildLogEntry[] = [];
  // Use the sites/ prefix so the bucket's public-read policy covers these objects.
  const prefix = `sites/${input.siteUuid}/media`;
  const urlMap = new Map<string, string>(); // original -> re-hosted URL

  async function rehostUrl(original: string, pageSlug: string): Promise<void> {
    if (urlMap.has(original)) return;
    // Skip URLs already on our own S3 bucket — they were re-hosted in a prior run.
    if (original.includes(input.config.S3_ASSETS_BUCKET)) return;
    try {
      const res = await fetch(original);
      if (!res.ok) throw new Error(`fetch ${original} → ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const ext = extForContentType(contentType);
      const key = `${prefix}/${hashFragment(original)}${ext}`;
      const newUrl = await uploadPipelineImage(input.s3, input.config, key, buf, contentType, { publicRead: true });
      urlMap.set(original, newUrl);
      log.push({
        category: "performance",
        description: `Re-hosted ${original} as ${newUrl}`,
        page: pageSlug,
      });
    } catch (err) {
      log.push({
        category: "performance",
        description: `Failed to re-host ${original}: ${(err as Error).message}`,
        page: pageSlug,
      });
    }
  }

  for (const page of hierarchy.pages) {
    for (const section of page.sections) {
      for (const img of section.content.images ?? []) {
        if (img?.url && !img.url.startsWith("data:")) await rehostUrl(img.url, page.slug);
      }
      for (const item of section.content.items ?? []) {
        if (item?.imageUrl && !item.imageUrl.startsWith("data:")) await rehostUrl(item.imageUrl, page.slug);
      }
    }
  }
  return { log, urlMap };
}

/**
 * Recursively upload all files in `distDir` to S3 under
 * `sites/{siteUuid}/` with public-read ACL, preserving directory structure.
 * Returns the base public URL for the site root.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

/**
 * Recursively upload all files in `distDir` to S3 under
 * `sites/{siteUuid}/` with public-read ACL, preserving directory structure.
 * Returns the public URL of the site's index.html.
 */
async function invalidateCloudFrontCache(
  distributionId: string | undefined,
  siteUuid: string,
): Promise<void> {
  if (!distributionId) return;
  try {
    const { CloudFrontClient, CreateInvalidationCommand } = await import("@aws-sdk/client-cloudfront");
    const cf = new CloudFrontClient({});
    await cf.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `build-${siteUuid}-${Date.now()}`,
          Paths: { Quantity: 1, Items: [`/sites/${siteUuid}/*`] },
        },
      }),
    );
  } catch {
    // Non-fatal — cache will expire naturally or next build will retry.
  }
}

async function deployDistToS3(
  distDir: string,
  s3: S3Client,
  config: Config,
  siteUuid: string,
): Promise<string> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { buildS3ObjectUrl } = await import("../../s3.js");

  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  const prefix = `sites/${siteUuid}`;

  async function uploadDir(dir: string, relBase: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await uploadDir(fullPath, relPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
        const body = await readFile(fullPath);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `${prefix}/${relPath}`,
            Body: body,
            ContentType: contentType,
            CacheControl: "no-store, no-cache, must-revalidate, max-age=0",
            // Public read handled by bucket policy.
          }),
        );
      }
    }
  }

  await uploadDir(distDir, "");

  return buildS3ObjectUrl({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket,
    key: `${prefix}/index.html`,
  });
}

function applyUrlMap(source: string, urlMap: Map<string, string>): string {
  let result = source;
  for (const [original, rehosted] of urlMap) {
    result = result.split(original).join(rehosted);
  }
  return result;
}

/** Rewrite source URL paths in rendered HTML so every internal link points to the
 *  generated Astro page slug. Only rewrites path-only hrefs (starting with `/`);
 *  full external URLs are left alone. */
function applyPathSlugMap(
  source: string,
  pageHrefToSlug: Map<string, string>,
): string {
  const mapHref = (href: string): string => {
    const normalized = href.replace(/\/$/, "").toLowerCase() || "/";
    const slug = pageHrefToSlug.get(normalized);
    return slug && slug !== "index" ? `/${slug}` : href;
  };
  return source.replace(/href=(['"])(\/[^'"]*?)\1/g, (match, quote, path) => {
    const newPath = mapHref(path);
    return newPath === path ? match : `href=${quote}${newPath}${quote}`;
  });
}

function extForContentType(ct: string): string {
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  return ".jpg";
}

function hashFragment(input: string): string {
  // Simple non-crypto hash; the goal is stable naming for cache identity.
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildDefaultSharedProps(
  section: HierarchySection,
  evidence: SectionVisualEvidenceRow | undefined,
): Record<string, unknown> {
  const dom = evidence?.domStyles;
  const defaults: Record<string, unknown> = {};
  if (
    section.content.heading !== undefined ||
    dom?.base?.headingText ||
    dom?.lg?.headingText
  ) {
    defaults.heading =
      section.content.heading ?? dom?.base?.headingText ?? dom?.lg?.headingText;
  }
  if (
    section.content.eyebrow !== undefined ||
    dom?.base?.eyebrowText ||
    dom?.lg?.eyebrowText
  ) {
    defaults.eyebrow =
      section.content.eyebrow ?? dom?.base?.eyebrowText ?? dom?.lg?.eyebrowText;
  }
  if (section.content.body !== undefined || dom?.base?.bodyText || dom?.lg?.bodyText) {
    defaults.body = section.content.body ?? dom?.base?.bodyText ?? dom?.lg?.bodyText;
  }
  if (section.content.cta || dom?.lg?.ctaLabel || dom?.lg?.ctaHref) {
    defaults.cta = section.content.cta ?? {
      label: dom?.lg?.ctaLabel,
      href: dom?.lg?.ctaHref,
    };
  }
  if (section.content.items !== undefined) {
    defaults.items = section.content.items;
  }
  if (section.content.images !== undefined) {
    defaults.images = section.content.images;
  }
  return defaults;
}

/** Shared components are often rendered by the LLM as prop-driven components,
 *  but pages that reuse them may not pass any `sharedProps`. Insert fallback
 *  defaults from the original section's content / DOM evidence so the
 *  component is self-contained and Astro build does not throw on undefined
 *  props. */
function addSharedComponentPropDefaults(
  source: string,
  section: HierarchySection,
  evidence: SectionVisualEvidenceRow | undefined,
): string {
  const defaults = buildDefaultSharedProps(section, evidence);
  if (Object.keys(defaults).length === 0) return source;

  // Match `const { heading, cta, ... } = Astro.props;` in the frontmatter.
  const propRegex = /const\s*\{\s*([\s\S]*?)\s*\}\s*=\s*Astro\.props\s*;/;
  const match = source.match(propRegex);
  if (!match || !match[1]) return source;

  const propsList = match[1]
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.includes("{") && !p.includes(":"));

  const assignments: string[] = [];
  for (const propName of propsList) {
    if (!(propName in defaults)) continue;
    assignments.push(
      `const ${propName} = Astro.props.${propName} ?? ${JSON.stringify(defaults[propName])};`,
    );
  }

  if (assignments.length === 0) return source;
  return source.replace(propRegex, assignments.join("\n"));
}

/**
 * Render all shared components once for a hierarchy (or a single page's
 * worth of sections). Returns a map of sharedComponentId → rendered Astro
 * source that `writeSharedComponents` / `generateAstroPage` can consume.
 *
 * Exported so both `runBuildStage` (whole-hierarchy build) and the legacy
 * per-page `buildPage` orchestrator can share the same rendering path.
 * Without this, page rendering that skips `sharedComponentId` sections
 * would fail at astro build time with a missing-import error.
 */
export async function renderSharedComponents(
  pages: HierarchyPage[],
  designSystem: DesignSystemV2,
  evidence: SectionVisualEvidence | null,
  config: Config,
  extractPageByPath?: Map<string, ExtractPage>,
  pageHrefToSlug?: Map<string, string>,
): Promise<Map<string, string>> {
  const built = new Map<string, string>();
  const tailwind: never[] = [];

  // Collect first-member sections for each unique sharedComponentId.
  const byId = new Map<
    string,
    { section: HierarchySection; page: HierarchyPage; propFields?: string[] }
  >();
  for (const page of pages) {
    for (const section of page.sections) {
      const id = section.sharedComponentId;
      if (!id || byId.has(id)) continue;
      const propFields = section.sharedProps ? Object.keys(section.sharedProps) : undefined;
      byId.set(id, { section, page, propFields });
    }
  }

  for (const [id, { section, page, propFields }] of byId) {
    const extractPage = page.path ? extractPageByPath?.get(page.path) : undefined;
    // Shared components that are nav-like must be rendered deterministically so
    // every page gets the exact extracted nav instead of an LLM hallucination.
    if (isNavSection(page, section, extractPage)) {
      const nav = buildExtractedNavFromLinks(
        extractPage!.content.navLinks ?? [],
        findLogoImage(section, designSystem.business.name),
        designSystem,
        pageHrefToSlug,
      );
      built.set(id, renderNavComponent(nav));
      continue;
    }

    const row = getEvidenceForSection(evidence, section);
    const extraInstructions =
      propFields && propFields.length
        ? `Expose these as Astro props with the shown defaults: ${JSON.stringify(propFields)}. Use \`Astro.props\` in the frontmatter and destructure each prop with a sensible default.`
        : undefined;
    const source = await renderVisualBlock({
      section,
      evidence: row,
      designSystem,
      tailwindInstructions: tailwind,
      extraInstructions,
      config,
    });
    built.set(id, addSharedComponentPropDefaults(source, section, row));
  }

  return built;
}

/** Detect whether a section is the page navigation/header. We use structural
 *  signals: first section on the page, its inner text contains common nav
 *  labels, and the extract artifact recorded nav links for this page.
 */
export function isNavSection(
  page: HierarchyPage,
  section: HierarchySection,
  extractPage: ExtractPage | undefined,
): boolean {
  if (!extractPage?.content.navLinks?.length) return false;
  const isFirst = page.sections[0]?.id === section.id;
  if (!isFirst) return false;

  const itemText = (section.content.items ?? [])
    .map((it) => [it.title ?? "", it.description ?? ""].join(" "))
    .join(" ");
  const text = [
    section.content.heading ?? "",
    section.content.body ?? "",
    section.content.eyebrow ?? "",
    itemText,
    section.content.cta?.label ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const navLabels = extractPage.content.navLinks.map((l) => l.label.toLowerCase());
  const matchCount = navLabels.filter((label) => text.includes(label)).length;
  const logoUrl = findLogoImage(section);
  const hasLogoImage = logoUrl !== undefined;
  return matchCount >= 2 || (hasLogoImage && matchCount >= 1);
}

const WIDGET_LOGO_DENYLIST = [
  "bugherd.com",
  "intercom",
  "zendesk",
  "crisp.chat",
  "crisp.im",
  "freshchat",
  "hubspot.com",
  "hs-scripts.com",
  "js.hs-scripts.com",
  "livechatinc.com",
  "chat-widget",
  "usemessages.com",
  "termly.io",
  "cookiebot.com",
  "usercentrics.eu",
  "reviews.io",
  "trustpilot.com",
  "feefo.com",
  "google.com",
  "gstatic.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.com",
  "fbcdn.net",
  "recaptcha",
  "klaviyo.com",
  "mailchimp.com",
  "chimpstatic.com",
];

const WIDGET_LOGO_PATH_DENYLIST = [
  "bh_logo",
  "intercom",
  "zendesk",
  "crisp",
  "freshchat",
  "hubspot",
  "livechat",
  "chat-widget",
  "usemessages",
  "termly",
  "cookiebot",
  "usercentrics",
  "reviews",
  "trustpilot",
  "feefo",
  "recaptcha",
  "grecaptcha",
  "googletagmanager",
  "gtm",
  "tracker",
  "pixel",
  "widget",
  "badge",
  "messenger",
];

function isWidgetImage(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    WIDGET_LOGO_DENYLIST.some((domain) => lower.includes(domain)) ||
    WIDGET_LOGO_PATH_DENYLIST.some((fragment) => lower.includes(fragment))
  );
}

/** Find the best logo image inside a section's captured images.
 *  Filters out common widget/chat/analytics images that are sometimes captured
 *  inside the nav bounding box, then scores by logo cues and business-name matches.
 */
export function findLogoImage(
  section: HierarchySection,
  businessName?: string,
): string | undefined {
  const images = section.content.images ?? [];
  if (!images.length) return undefined;

  const nameTokens = (businessName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = images
    .filter((img) => !isWidgetImage(img.url))
    .map((img) => {
      const url = img.url ?? "";
      const lowerUrl = url.toLowerCase();
      const alt = (img.alt ?? "").toLowerCase();
      let score = 0;
      if (lowerUrl.includes("logo")) score += 100;
      if (lowerUrl.includes("brand")) score += 50;
      if (lowerUrl.includes("wordmark")) score += 40;
      if (nameTokens.some((t) => lowerUrl.includes(t) || alt.includes(t))) score += 35;
      if (alt.includes("logo")) score += 30;
      if (lowerUrl.match(/\.(png|svg)(\?|$)/)) score += 20;
      if (lowerUrl.includes("secondary")) score -= 80;
      if (lowerUrl.includes("icon")) score -= 40;
      return { url, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  return best && best.score > 0 ? best.url : undefined;
}

/** Normalize a captured source href against the generated page slug map.
 *  Falls back to the original href when the path isn't part of the built site
 *  (e.g. external URLs, anchors, mailto). */
function normalizeHref(
  href: string,
  pageHrefToSlug?: Map<string, string>,
): string {
  if (!pageHrefToSlug) return href;
  const stripped = href.replace(/\/$/, "").toLowerCase() || "/";
  const normalized = stripped.startsWith("/") ? stripped : `/${stripped}`;
  const slug = pageHrefToSlug.get(normalized);
  if (slug && slug !== "index") {
    return `/${slug}`;
  }
  return href;
}

/** Rewrite an already-built ExtractedNav so every internal href points to the
 *  generated Astro page slug instead of the original source URL path. */
function mapExtractedNavHrefs(
  nav: ExtractedNav,
  pageHrefToSlug?: Map<string, string>,
): ExtractedNav {
  if (!pageHrefToSlug) return nav;
  const mapLink = (link: NavLink): NavLink => ({
    ...link,
    href: normalizeHref(link.href, pageHrefToSlug),
    children: link.children?.map(mapLink),
  });
  return {
    ...nav,
    links: nav.links.map(mapLink),
    cta: nav.cta
      ? { ...nav.cta, href: normalizeHref(nav.cta.href, pageHrefToSlug) }
      : undefined,
  };
}

/** Build a hierarchical ExtractedNav from the flat navLinks captured by the
 *  extract stage. We group program/class links under a "Programs" dropdown when
 *  present, matching the source site's structure.
 */
export function buildExtractedNavFromLinks(
  navLinks: NavLink[],
  logoUrl: string | undefined,
  designSystem: DesignSystemV2,
  pageHrefToSlug?: Map<string, string>,
): ExtractedNav {
  const tokens = designSystem.global.tokens;
  const bg = tokens.colors.background ?? "#ffffff";
  const fg = tokens.colors.foreground ?? "#000000";

  // Specific program/class names become children under a "Programs" dropdown.
  // Generic labels like "Programs", "Classes", or "Schedule" stay at the top level.
  const PROGRAM_HINTS = [
    "crossfit", "bootcamp", "sweat", "crosstrain", "crosstrain", "kids", "teens",
    "personal training", "private training", "yoga", "olympic", "weightlifting",
    "barbell", "endurance", "strength", "conditioning", "hiit", "functional",
  ];

  // Deduplicate by normalized href, keeping the first label we see. Also
  // collapse whitespace and trim labels so "Drop In" and "Drop-In" don't
  // both appear as separate top-level links.
  const seenHrefs = new Set<string>();
  const dedupedNavLinks: NavLink[] = [];
  for (const link of navLinks) {
    const key = normalizeHref(link.href, pageHrefToSlug);
    const dedupKey = key.replace(/\/$/, "").toLowerCase() || "/";
    if (seenHrefs.has(dedupKey)) continue;
    seenHrefs.add(dedupKey);
    dedupedNavLinks.push({
      ...link,
      href: key,
      label: link.label.replace(/\s+/g, " ").trim(),
    });
  }

  const programChildren: NavLink[] = [];
  const otherLinks: NavLink[] = [];

  for (const link of dedupedNavLinks) {
    const lower = link.label.toLowerCase();
    const isGenericParent = ["programs", "classes", "class schedule", "schedule", "timetable"].includes(lower);
    if (!isGenericParent && PROGRAM_HINTS.some((h) => lower.includes(h))) {
      programChildren.push(link);
    } else {
      otherLinks.push(link);
    }
  }

  const links: NavLink[] = [];
  // If we found concrete program links, surface a Programs dropdown.
  if (programChildren.length >= 2) {
    links.push({ label: "Programs", href: "#", children: programChildren });
  } else if (programChildren.length === 1) {
    links.push(programChildren[0]!);
  }
  links.push(...otherLinks);

  const logo = logoUrl
    ? { type: "image" as const, value: logoUrl, alt: designSystem.business.name ?? "" }
    : designSystem.brand.logo;

  return {
    position: "top-sticky",
    background: bg,
    textColor: fg,
    logo,
    links,
    hasMobileToggle: true,
    mobileMenuBackground: tokens.colors.muted ?? bg,
  };
}

/**
 * Render one page's non-shared section files. Returns { section, source }
 * tuples — the caller passes them to `writePageFiles`.
 */
async function renderPageSections(
  page: HierarchyPage,
  designSystem: DesignSystemV2,
  evidence: SectionVisualEvidence | null,
  config: Config,
  extractedNav: ExtractedNav | null,
  pageHrefToSlug: Map<string, string>,
  extractPage: ExtractPage | undefined,
  animationNames: string[],
  lottieUrls: string[],
): Promise<{ section: HierarchySection; source: string; isFallback: boolean }[]> {
  const tailwind: never[] = [];

  // Render all sections in parallel — each LLM call is independent.
  const results = await Promise.all(
    page.sections.map(async (section, i) => {
      if (!section) return null;
      if (section.sharedComponentId) return null; // handled by shared build
      const previousTag = page.sections[i - 1]?.tag;
      const nextTag = page.sections[i + 1]?.tag;

      if (section.tag === "header" || isNavSection(page, section, extractPage)) {
        // Deterministic nav renderer: uses extracted DOM data, no LLM.
        const nav = section.tag === "header" && extractedNav
          ? mapExtractedNavHrefs(extractedNav, pageHrefToSlug)
          : buildExtractedNavFromLinks(
              extractPage!.content.navLinks ?? [],
              findLogoImage(section, designSystem.business.name),
              designSystem,
              pageHrefToSlug,
            );
        if (nav) {
          return {
            section,
            source: renderNavComponent(nav),
            isFallback: false,
          };
        }
        // Fall back to semantic renderer if no extractedNav available.
        const headerSection = designSystem.global.shell.header ?? makeDefaultHeader(designSystem);
        return { section, source: renderSemanticSection(headerSection), isFallback: false };
      } else if (section.tag === "footer") {
        const footerSection = designSystem.global.shell.footer ?? makeDefaultFooter(designSystem);
        return { section, source: renderSemanticSection(footerSection), isFallback: false };
      } else {
        // For cloning, all non-shell sections go through the LLM with the
        // screenshot — the tag is provided as context in the prompt but we
        // don't bypass the visual renderer with a static template.
        const row = getEvidenceForSection(evidence, section);
        const result = await renderVisualBlockWithFlag({
          section,
          evidence: row,
          designSystem,
          tailwindInstructions: tailwind,
          previousTag,
          nextTag,
          animationNames,
          lottieUrls,
          config,
        });
        return { section, source: result.code, isFallback: result.isFallback };
      }
    }),
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

interface RunProcessOptions {
  stdin?: "ignore" | "pipe";
  /** Called for every non-empty line emitted by the subprocess. */
  onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
}

const ANSI_ESCAPE_RE =
  /[][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

function sanitizeLogLine(line: string): string {
  // Strip ANSI escape codes and trailing carriage returns so logs are safe for
  // JSON/SSE and render cleanly in the terminal-style UI.
  return line.replace(ANSI_ESCAPE_RE, "").replace(/\r+$/, "");
}

/** Run a subprocess in the given directory; resolves when done. Throws on non-zero exit.
 *  Streams stdout/stderr line-by-line through onLogLine. */
async function runProcess(cmd: string, args: string[], cwd: string, opts?: RunProcessOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdio: ["ignore" | "pipe", "pipe", "pipe"] =
      opts?.stdin === "ignore" ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"];
    const child = spawn(cmd, args, { cwd, env: process.env, stdio });
    let stdoutBuffer = "";
    let stderrBuffer = "";

    function emitLine(line: string, stream: "stdout" | "stderr") {
      if (line === "") return;
      opts?.onLogLine?.(sanitizeLogLine(line), stream);
    }

    function flushBuffer(buffer: string, stream: "stdout" | "stderr"): string {
      let remaining = buffer;
      let idx: number;
      while ((idx = remaining.indexOf("\n")) !== -1) {
        emitLine(remaining.slice(0, idx), stream);
        remaining = remaining.slice(idx + 1);
      }
      return remaining;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer = flushBuffer(stdoutBuffer + chunk.toString(), "stdout");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer = flushBuffer(stderrBuffer + chunk.toString(), "stderr");
    });

    child.on("close", (code) => {
      emitLine(stdoutBuffer, "stdout");
      emitLine(stderrBuffer, "stderr");
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? "null"} in ${cwd}\nstdout: ${stdoutBuffer}\nstderr: ${stderrBuffer}`));
    });
    child.on("error", (err) => {
      reject(err);
    });
  });
}

const ASTRO_CHECK_TIMEOUT_MS = 90_000;

/** Run `astro check` in the given source dir. Returns an empty array if the
 *  Astro CLI is not installed (best-effort) or if it times out. */
async function runAstroCheck(sourceDir: string): Promise<AstroCheckError[]> {
  const astroBin = path.join(sourceDir, "node_modules", ".bin", "astro");
  if (!(await fileExists(astroBin))) return [];
  return new Promise((resolve) => {
    const child = spawn(astroBin, ["check"], { cwd: sourceDir, env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result: AstroCheckError[]) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(result);
    };
    const timer = setTimeout(() => {
      console.log(`[build] astro check timed out after ${ASTRO_CHECK_TIMEOUT_MS / 1000}s — skipping`);
      settle([]);
    }, ASTRO_CHECK_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", () => { clearTimeout(timer); settle(parseAstroCheckOutput(`${stdout}\n${stderr}`)); });
    child.on("error", () => { clearTimeout(timer); settle([]); });
  });
}

function parseAstroCheckOutput(output: string): AstroCheckError[] {
  const errors: AstroCheckError[] = [];
  // Rough parser: match lines like "src/pages/index.astro:12:5 - ..."
  const re = /(src\/(?:pages|components)\/[^\s:]+\.astro)[:\s]+([^\n]+)/g;
  for (const match of output.matchAll(re)) {
    errors.push({ file: match[1] as string, message: match[2] as string });
  }
  return errors;
}

export async function runBuildStage(input: BuildStageInput): Promise<BuildStageResult> {
  const ctx: ArtifactContext = {
    siteUuid: input.siteUuid,
    workspaceUuid: input.workspaceUuid,
  };

  // Capture every subprocess line for live streaming and later replay.
  const rawLines: BuildLogLine[] = [];
  const onLogLine = (line: string, stream: "stdout" | "stderr") => {
    const entry: BuildLogLine = { stream, line, at: new Date().toISOString() };
    rawLines.push(entry);
    input.onLogLine?.(line, stream);
  };

  // Heartbeat so the UI sees motion during every long-running phase — not just
  // the subprocess calls. Callers update the message as work moves through
  // loading docs, rendering sections, installing, compiling, and deploying.
  const HEARTBEAT_INTERVAL_MS = 5000;
  let heartbeatMessage = "Building site…";
  let heartbeatElapsedSeconds = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  function setHeartbeatMessage(message: string) {
    heartbeatMessage = message;
    heartbeatElapsedSeconds = 0;
    input.onProgress?.({ stage: "build", message: heartbeatMessage });
  }
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
  if (input.onProgress) {
    heartbeatTimer = setInterval(() => {
      heartbeatElapsedSeconds += HEARTBEAT_INTERVAL_MS / 1000;
      input.onProgress?.({
        stage: "build",
        message: `${heartbeatMessage} (${Math.round(heartbeatElapsedSeconds)}s)`,
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  try {

  // 1. Load docs.
  const hierarchy = await loadSiteHierarchyDoc(input.db, input.workspaceUuid, input.siteUuid);
  if (!hierarchy) {
    throw new Error(`Site hierarchy not found for site ${input.siteUuid}`);
  }
  const designSystemDoc = await loadDesignSystemDoc(input.db, input.workspaceUuid, input.siteUuid);
  if (!designSystemDoc || designSystemDoc.version !== "2") {
    throw new Error(`Design system v2 not found for site ${input.siteUuid}`);
  }
  let designSystem = designSystemDoc as DesignSystemV2;
  if (!designSystem.siteMetadata?.mode) {
    const siteMode = await loadSiteMode(input.db, input.siteUuid);
    if (siteMode) {
      designSystem = designSystemWithMode(designSystem, siteMode);
    }
  }
  const rawEvidence = await loadSectionVisualEvidenceDoc(input.db, input.workspaceUuid, input.siteUuid);

  // Convert private S3 screenshot URLs to base64 data URIs so the LLM provider
  // can receive the images inline rather than trying to fetch private bucket URLs.
  const s3ctx: S3Context = {
    s3: input.s3,
    bucket: input.config.S3_ASSETS_BUCKET,
    region: input.config.S3_REGION,
    endpoint: input.config.S3_ENDPOINT,
  };
  const evidence = rawEvidence
    ? {
        ...rawEvidence,
        rows: await Promise.all(
          rawEvidence.rows.map(async (row) => ({
            ...row,
            screenshotUrl: row.screenshotUrl
              ? await imageUrlToDataUri(row.screenshotUrl, s3ctx)
              : row.screenshotUrl,
            mobileScreenshotUrl: row.mobileScreenshotUrl
              ? await imageUrlToDataUri(row.mobileScreenshotUrl, s3ctx)
              : row.mobileScreenshotUrl,
          })),
        ),
      }
    : null;

  const buildLog: BuildLogEntry[] = [];
  const fallbacks: Array<{ sectionId: string; page: string }> = [];

  // 2. Media re-hosting pre-pass.
  // We build a urlMap (original → re-hosted) but do NOT mutate the hierarchy's
  // image URLs — the LLM prompt must reference the original public CDN URLs so
  // browsers can load them during verify. The urlMap is applied as a
  // post-render string substitution in the generated Astro code.
  const { log: mediaLog, urlMap: rehostUrlMap } = await rehostMedia(hierarchy, {
    s3: input.s3,
    config: input.config,
    workspaceUuid: input.workspaceUuid,
    siteUuid: input.siteUuid,
  });
  buildLog.push(...mediaLog);

  // Also re-host the brand logo URL so the nav component gets a valid public URL.
  // The LLM may reference the logo from the design system or from the screenshot,
  // but the original URL may be on a restricted CDN. Re-hosting ensures it's public.
  const logoUrl = designSystem.brand.logo.type === "image" ? designSystem.brand.logo.value : null;
  if (logoUrl && !logoUrl.startsWith("data:") && !rehostUrlMap.has(logoUrl)) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") ?? "image/png";
        const ext = ct.includes("svg") ? ".svg" : ct.includes("png") ? ".png" : ".jpg";
        const key = `sites/${input.siteUuid}/media/logo${ext}`;
        const newUrl = await uploadPipelineImage(input.s3, input.config, key, buf, ct);
        rehostUrlMap.set(logoUrl, newUrl);
        buildLog.push({ category: "performance", description: `Re-hosted logo ${logoUrl} as ${newUrl}` });
      }
    } catch { /* non-fatal — logo stays as original */ }
  }

  // 3. Determine scope.
  // input.pages may be URL-path form ("/", "/about") or slug form ("index", "about").
  // Normalise to slug form so the filter works regardless of which the caller passes.
  const rawScope = input.pages ?? hierarchy.buildPlan.buildOrder;
  const scope = new Set(rawScope.map((s) => {
    if (s === "/" || s === "index") return "index";
    const withoutLeading = s.replace(/^\//, "");
    // If it looks like a slug already (no slashes, lowercase, hyphens), keep it.
    // Otherwise treat it as a path and slugify it via the same rules pathToSlug uses.
    return withoutLeading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "index";
  }));
  const scopedPages = hierarchy.pages.filter((p) => scope.has(p.slug));

  // 4. Prepare source dir + scaffold.
  const sourceDir =
    input.sourceDir ??
    path.join(os.tmpdir(), "milo-build", input.siteUuid, "build");
  await mkdir(sourceDir, { recursive: true });
  // Load web font URLs, CSS animations, Lottie URLs, and extractedNav from the extract artifact.
  const extractArtifact = await loadArtifact<ExtractArtifact>(
    input.db, { siteUuid: input.siteUuid, workspaceUuid: input.workspaceUuid }, "extract",
  );
  const webFontUrls = extractArtifact?.payload?.css?.webFontUrls ?? [];
  const cssAnimations = extractArtifact?.payload?.css?.animations ?? [];
  const extractedNav: ExtractedNav | null = extractArtifact?.payload?.extractedNav ?? null;
  const extractPages = extractArtifact?.payload?.pages ?? [];
  const extractPageByPath = new Map(extractPages.map((p) => [p.path, p]));
  // Build a map from original URL path to generated Astro slug so nav links can
  // point to the generated pages instead of the source URLs.
  const pageHrefToSlug = new Map(
    hierarchy.pages.map((p) => {
      const key = (p.path ?? "/").replace(/\/$/, "").toLowerCase() || "/";
      return [key.startsWith("/") ? key : `/${key}`, p.slug];
    }),
  );

  // Collect all Lottie JSON URLs across all extracted pages (deduplicated).
  const rawLottieUrls = Array.from(new Set(
    (extractArtifact?.payload?.pages ?? []).flatMap((p) => p.content.lottieUrls ?? []),
  ));

  // Re-host Lottie JSON files to our S3 bucket so the build can use stable URLs.
  const lottieUrlMap = new Map<string, string>(); // original → re-hosted
  for (const lottieUrl of rawLottieUrls) {
    try {
      const res = await fetch(lottieUrl);
      if (!res.ok) throw new Error(`fetch ${lottieUrl} → ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const key = `sites/${input.siteUuid}/media/lottie/${hashFragment(lottieUrl)}.json`;
      const newUrl = await uploadPipelineImage(input.s3, input.config, key, buf, "application/json", { publicRead: true });
      lottieUrlMap.set(lottieUrl, newUrl);
      buildLog.push({ category: "performance", description: `Re-hosted Lottie ${lottieUrl} as ${newUrl}` });
    } catch (err) {
      buildLog.push({ category: "performance", description: `Failed to re-host Lottie ${lottieUrl}: ${(err as Error).message}` });
    }
  }

  const hasLottie = lottieUrlMap.size > 0;
  // Build the list of re-hosted Lottie URLs to pass to the renderer.
  const rehostedLottieUrls = Array.from(lottieUrlMap.values());

  await writeProjectScaffold(sourceDir, designSystem, { webFontUrls, cssAnimations, hasLottie });
  input.onProgress?.({
    stage: "build",
    message: "Project scaffold ready",
    detail: { mode: designSystem.siteMetadata.mode },
  });

  // 5. Shared components — render once for all pages in the hierarchy so
  //    downstream page imports always resolve.
  const sharedComponents = await renderSharedComponents(
    hierarchy.pages,
    designSystem,
    evidence,
    input.config,
    extractPageByPath,
    pageHrefToSlug,
  );
  const sharedComponentsBuilt: string[] = [];
  // Write shared components (plus Header/Footer) into the scaffold via
  // writePageFiles' scaffold write path — but shared components are file-level
  // artifacts, not tied to a specific page. Write them directly.
  for (const [id, source] of sharedComponents) {
    const filePath = path.join(
      sourceDir,
      "src",
      "components",
      "shared",
      `${sharedComponentFileName(id)}.astro`,
    );
    const sourceWithUrls = applyUrlMap(source, rehostUrlMap);
    const sourceWithPaths = applyPathSlugMap(sourceWithUrls, pageHrefToSlug);
    await writeFile(filePath, sourceWithPaths);
    sharedComponentsBuilt.push(id);
  }

  // Also emit the Header / Footer semantic files so page-level imports
  // succeed; these mirror what `writeProjectFiles` does per-page.
  await writeHeaderFooter(sourceDir, designSystem);

  setHeartbeatMessage("Rendering pages…");

  // 6. Per-page loop.
  const builtPages: string[] = [];
  let currentHierarchy = hierarchy;
  const t0 = Date.now();
  for (const page of scopedPages) {
    const pageT = Date.now();
    console.log(`[build] rendering page "${page.slug}" (${page.sections.length} sections, parallel)`);
    currentHierarchy = updatePageStatus(currentHierarchy, page.slug, "in_progress");
    const extractPage = page.path ? extractPageByPath.get(page.path) : undefined;
    const rendered = await renderPageSections(page, designSystem, evidence, input.config, extractedNav, pageHrefToSlug, extractPage, cssAnimations.map((a) => a.name), rehostedLottieUrls);
    // Apply re-hosted URL substitution and source-path → slug rewriting so every
    // internal link resolves to a generated Astro page instead of the source site.
    const renderedWithUrls = rendered.map(({ section, source, isFallback }) => ({
      section,
      isFallback,
      source: applyPathSlugMap(applyUrlMap(source, rehostUrlMap), pageHrefToSlug),
    }));
    const renderMs = Date.now() - pageT;
    const fallbackCount = renderedWithUrls.filter(r => r.isFallback).length;
    // Log per-section outcome.
    for (const { section, isFallback } of renderedWithUrls) {
      if (isFallback) {
        console.log(`[build]   ⚠  ${section.id} (${section.tag}) — fallback block`);
      } else {
        console.log(`[build]   ✓  ${section.id} (${section.tag})`);
      }
    }
    console.log(`[build]   ⏱ render: ${(renderMs/1000).toFixed(1)}s — ${renderedWithUrls.length} sections, ${fallbackCount} fallbacks`);
    await writePageFiles(sourceDir, page, renderedWithUrls);
    currentHierarchy = updatePageStatus(currentHierarchy, page.slug, "built");
    builtPages.push(page.slug);
    input.onProgress?.({
      stage: "build",
      message: `Rendered page /${page.slug === "index" ? "" : page.slug}`,
      detail: { pageSlug: page.slug, sectionCount: renderedWithUrls.length, fallbackCount },
    });
  }
  console.log(`[build] ⏱ all pages rendered in ${((Date.now()-t0)/1000).toFixed(1)}s`);

  // 6b. Write stub redirect pages for nav-linked pages not in the current build scope.
  // These ensure nav links resolve (no 404s) — unbuilt pages redirect to the original site.
  const builtSet = new Set(builtPages);
  const unbuiltNavPages = hierarchy.buildPlan.buildOrder.filter(
    (slug) => !builtSet.has(slug) && slug !== "index",
  );
  if (unbuiltNavPages.length > 0) {
    const sourceUrl = hierarchy.siteMetadata.targetUrl?.replace(/\/$/, "") ?? "";
    for (const slug of unbuiltNavPages) {
      const originalPath = slug === "index" ? "/" : `/${slug.replace(/-/g, "/")}`;
      const redirectUrl = sourceUrl ? `${sourceUrl}${originalPath}` : originalPath;
      const stubFile = slug === "index"
        ? path.join(sourceDir, "src", "pages", "index.astro")
        : path.join(sourceDir, "src", "pages", `${slug}.astro`);
      const stubSource = `---\n// Stub: redirects to original site until this page is cloned\n---\n<meta http-equiv="refresh" content="0; url=${redirectUrl}" />\n<link rel="canonical" href="${redirectUrl}" />\n`;
      // Don't overwrite pages that were already built
      if (!builtSet.has(slug)) {
        await mkdir(path.dirname(stubFile), { recursive: true });
        await writeFile(stubFile, stubSource);
      }
    }
    console.log(`[build] ↪ ${unbuiltNavPages.length} stub redirect page(s) for unbuilt nav targets`);
  }

  // 7. Install deps so `astro check` has the packages it needs. This must run
  //    before the check passes — without node_modules astro check exits immediately
  //    and skips real validation, but with a stale node_modules from a prior run
  //    it would hang waiting on the TypeScript language server.
  if (input.runAstroBuild) {
    setHeartbeatMessage("Installing dependencies…");
    const tInstall = Date.now();
    console.log(`[build] running pnpm install in ${sourceDir}`);
    // Force non-interactive mode and answer yes to any prompts by feeding stdin
    // from /dev/null. This prevents pnpm from hanging on TTY prompts when the
    // temp build dir is reused or the store has stale symlinks.
    await runProcess("pnpm", ["install", "--reporter=append-only", "--config.interactive=false"], sourceDir, {
      stdin: "ignore",
      onLogLine,
    });
    console.log(`[build] ⏱ pnpm install: ${((Date.now()-tInstall)/1000).toFixed(1)}s`);
  }

  // 7b. astro check post-pass (best-effort, opt-in).
  if (input.runAstroCheck) {
    const errors = await runAstroCheck(sourceDir);
    for (const err of errors) {
      const match = err.file.match(/components\/sections\/([^/]+)\.astro$/);
      const sectionId = match?.[1];
      if (!sectionId) continue;
      // Find the page + section this file came from.
      let ownerPage: HierarchyPage | undefined;
      let ownerSection: HierarchySection | undefined;
      for (const p of scopedPages) {
        const s = p.sections.find((sec) => sec.id === sectionId);
        if (s) {
          ownerPage = p;
          ownerSection = s;
          break;
        }
      }
      if (!ownerPage || !ownerSection) continue;

      const row = getEvidenceForSection(evidence, ownerSection);
      const tailwind: never[] = [];
      try {
        const retry = await renderVisualBlockWithFlag({
          section: ownerSection,
          evidence: row,
          designSystem,
          tailwindInstructions: tailwind,
          extraInstructions: `Your previous output failed astro check with: ${err.message}. Fix and return the corrected component.`,
          config: input.config,
        });
        const filePath = path.join(
          sourceDir,
          "src",
          "components",
          "sections",
          `${sectionId}.astro`,
        );
        await writeFile(filePath, retry.code);
        // If renderVisualBlock silently fell back (missing evidence, empty LLM
        // response, or thrown LLM error) we still overwrote the file — but
        // with deterministic content, not a fixed LLM output. Record it so
        // callers know the retry didn't actually succeed.
        if (retry.isFallback) {
          fallbacks.push({ sectionId, page: ownerPage.slug });
          buildLog.push({
            category: "consistency",
            description: `LLM retry fell back to deterministic block for ${sectionId}`,
            page: ownerPage.slug,
          });
        }
      } catch {
        const filePath = path.join(
          sourceDir,
          "src",
          "components",
          "sections",
          `${sectionId}.astro`,
        );
        await writeFile(filePath, renderFallbackBlock(ownerSection, designSystem));
        fallbacks.push({ sectionId, page: ownerPage.slug });
        buildLog.push({
          category: "semantics",
          description: `Fell back to deterministic block for section ${sectionId} after astro check failure`,
          page: ownerPage.slug,
        });
      }
    }

    // Second astro check to catch retries that still failed → fall back.
    const errors2 = await runAstroCheck(sourceDir);
    for (const err of errors2) {
      const match = err.file.match(/components\/sections\/([^/]+)\.astro$/);
      const sectionId = match?.[1];
      if (!sectionId) continue;
      let ownerPage: HierarchyPage | undefined;
      let ownerSection: HierarchySection | undefined;
      for (const p of scopedPages) {
        const s = p.sections.find((sec) => sec.id === sectionId);
        if (s) {
          ownerPage = p;
          ownerSection = s;
          break;
        }
      }
      if (!ownerPage || !ownerSection) continue;
      const filePath = path.join(
        sourceDir,
        "src",
        "components",
        "sections",
        `${sectionId}.astro`,
      );
      await writeFile(filePath, renderFallbackBlock(ownerSection, designSystem));
      if (!fallbacks.some((f) => f.sectionId === sectionId && f.page === ownerPage!.slug)) {
        fallbacks.push({ sectionId, page: ownerPage.slug });
        buildLog.push({
          category: "semantics",
          description: `Second astro check failure for section ${sectionId} — using fallback`,
          page: ownerPage.slug,
        });
      }
    }
  }

  if (fallbacks.length > 0) {
    console.log(`[build] ⚠  ${fallbacks.length} section(s) fell back to deterministic block: ${fallbacks.map(f => f.sectionId).join(", ")}`);
  }

  // 7c. Compile Astro to dist/ so verify can serve the clone.
  // Opt-in: tests skip this because they use synthetic scaffolds without real lockfiles.
  let deployUrl: string | null = null;
  if (input.runAstroBuild) {
    setHeartbeatMessage("Compiling Astro site…");
    const tBuild = Date.now();
    console.log(`[build] running astro build in ${sourceDir}`);
    await runProcess("pnpm", ["exec", "astro", "build"], sourceDir, {
      stdin: "ignore",
      onLogLine,
    });
    // Make asset paths relative and inline CSS so the site is self-contained
    // when served from an S3 subdirectory (no root-relative /_astro/ paths).
    const distDir = path.join(sourceDir, "dist");
    await relativizeAssetPaths(distDir);
    await inlineCssIntoHtml(distDir);
    console.log(`[build] ⏱ astro build: ${((Date.now()-tBuild)/1000).toFixed(1)}s`);
    console.log(`[build] astro build complete`);
    input.onProgress?.({ stage: "build", message: "Astro build complete" });

    // 7d. Deploy dist/ to S3 so the site is publicly accessible.
    try {
      setHeartbeatMessage("Deploying to S3…");
      const tDeploy = Date.now();
      deployUrl = await deployDistToS3(distDir, input.s3, input.config, input.siteUuid);
      console.log(`[build] ⏱ S3 deploy: ${((Date.now()-tDeploy)/1000).toFixed(1)}s`);
      console.log(`[build] deployed → ${deployUrl}`);
      setHeartbeatMessage("Site deployed");

      // CloudFront caches the previous build; invalidate the site path so the
      // preview URL shows the fresh output immediately.
      await invalidateCloudFrontCache(input.config.CLOUDFRONT_DISTRIBUTION_ID, input.siteUuid);
    } catch (err) {
      console.warn(`[build] S3 deploy failed (non-fatal): ${(err as Error).message}`);
      input.onProgress?.({
        stage: "build",
        message: `S3 deploy failed: ${(err as Error).message}`,
      });
    }
  }

  // 8. Save updated hierarchy.
  await saveSiteHierarchyDoc(input.db, input.workspaceUuid, input.siteUuid, currentHierarchy);

  // 9. Persist build artifact.
  const artifactPayload = {
    builtPages,
    sharedComponentsBuilt,
    buildLog,
    fallbacks,
    deployUrl,
    rawLines,
  };
  await saveArtifact(input.db, ctx, "build", artifactPayload);

    return {
      builtPages,
      sharedComponentsBuilt,
      buildLog,
      fallbacks,
      sourceDir,
      deployUrl,
      rawLines,
    };
  } finally {
    stopHeartbeat();
  }
}

async function writeHeaderFooter(sourceDir: string, designSystem: DesignSystemV2): Promise<void> {
  // Skip the synthetic global shell in replication mode; the original header/footer
  // are already rendered as page sections.
  if (designSystem.siteMetadata.mode === "replication") return;

  const headerSection = designSystem.global.shell.header ?? makeDefaultHeader(designSystem);
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Header.astro"),
    renderSemanticSection(headerSection),
  );
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Footer.astro"),
    renderSemanticSection(designSystem.global.shell.footer ?? makeDefaultFooter(designSystem)),
  );
}
