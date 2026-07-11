import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { applyTransforms, pageGlobMatches } from "../../utils/mirror/apply-transforms";
import { buildRedirectHtml, generateRobots, generateSitemap } from "../../utils/mirror/site-meta";
import { pathToFileKey, pathToOutlineKey } from "./snapshot";
import type { MirrorSnapshotArtifact, SiteTransformRecord, TransformType } from "../../types/mirror";
import { INTERCEPTOR_SCRIPT } from "../../utils/mirror/interceptor";
import * as cheerio from "cheerio";

async function bounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) await fn(item);
  });
  await Promise.all(workers);
}

/**
 * Extract a semantic content outline from page HTML.
 * Preserves heading hierarchy and section context so LLMs can map
 * content to template slots without raw HTML noise.
 */
export interface CapturedNavItem {
  label: string;
  href: string;
  children?: CapturedNavItem[];
}

/**
 * Extract the site's navigation structure from homepage HTML.
 * Captures the gym's own labels and hierarchy exactly as-built.
 * The generate stage maps hrefs to template routes while keeping labels.
 */
export function extractNavStructure(html: string, origin: string): CapturedNavItem[] {
  const $ = cheerio.load(html);

  // Find the primary nav — prefer elements with nav-ish class/role, skip footer navs
  const navCandidates = [
    $("nav[role='navigation']"),
    $("nav.w-nav"),
    $("nav").not("footer nav").first(),
    $("[class*='navbar']").first(),
    $("[class*='nav-menu']").first(),
  ];
  let $nav = navCandidates.find((el) => el.length > 0) ?? $("nav").first();
  if (!$nav || !$nav.length) return [];

  function normalizeHref(href: string): string {
    if (!href || href === "#" || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return "";
    try {
      const url = new URL(href, origin);
      // Only keep same-origin links
      const sameOrigin = url.origin === new URL(origin).origin || href.startsWith("/");
      if (!sameOrigin) return "";
      return url.pathname;
    } catch {
      return href.startsWith("/") ? href : "";
    }
  }

  function parseItems($container: ReturnType<typeof $>, depth = 0): CapturedNavItem[] {
    if (depth > 3) return [];
    const items: CapturedNavItem[] = [];
    const seen = new Set<string>();

    $container.find("> li, > div > li, > ul > li").each((_, el) => {
      const $el = $(el);
      // Skip utility items (login, search, account)
      const elText = $el.text().trim().toLowerCase();
      if (/^(login|sign in|sign up|account|search|cart|\d+)$/i.test(elText)) return;

      const $link = $el.children("a").first();
      const label = $link.text().replace(/\s+/g, " ").trim();
      if (!label || label.length < 1 || label.length > 50) return;

      const href = normalizeHref($link.attr("href") ?? "");
      const key = `${label}|${href}`;
      if (seen.has(key)) return;
      seen.add(key);

      // Recurse into dropdowns (nested ul or div with links)
      const $dropdown = $el.find("ul, [class*='dropdown'], [class*='submenu']").first();
      const children = $dropdown.length ? parseItems($dropdown, depth + 1) : [];

      // Skip cross-origin links (normalizeHref returns "" for them)
      if (!href && children.length === 0) return;
      items.push({ label, href: href || "/", ...(children.length ? { children } : {}) });
    });

    return items;
  }

  // Try parsing as a list-based nav first
  const $ul = $nav.find("ul").first();
  let items = $ul.length ? parseItems($ul) : [];

  // Fallback: flat link extraction if no list structure
  if (items.length === 0) {
    $nav.find("a[href]").each((_, el) => {
      const label = $(el).text().replace(/\s+/g, " ").trim();
      const href = normalizeHref($(el).attr("href") ?? "");
      if (label && href && label.length < 50) {
        items.push({ label, href });
      }
    });
  }

  return items.slice(0, 12); // cap at 12 top-level items
}

/**
 * Extract the hero background image URL from page HTML.
 * Returns the `/_assets/...` relative URL of the first prominent image
 * found in the hero section, or undefined if none found.
 */
export function extractHeroImageUrl(html: string): string | undefined {
  const $ = cheerio.load(html);

  // Check og:image meta first — most reliable signal for the hero image
  const ogImage = $("meta[property='og:image']").attr("content");
  if (ogImage?.startsWith("/_assets/")) return ogImage;

  // Then look for the first <img> in a hero-ish section
  const heroSelectors = "[class*='hero'], [class*='banner'], section:first-of-type";
  const heroImg = $(heroSelectors).find("img[src^='/_assets/']").first().attr("src");
  if (heroImg) return heroImg;

  // Finally any large img anywhere in the page body (first one, above-fold)
  const firstImg = $("body").find("img[src^='/_assets/']").first().attr("src");
  return firstImg ?? undefined;
}

export function extractContentOutline(html: string): string {
  const $ = cheerio.load(html);

  // Remove scripts/embeds unconditionally; scope header/footer/nav to top-level
  // layout elements only — Webflow often puts hero content inside a <header> tag.
  $("script, style, noscript, iframe, [aria-hidden='true'], [class*='cookie'], [class*='popup']").remove();
  $("body > header, body > footer, body > nav").remove();

  const SECTION_SELECTORS = [
    "section",
    "article",
    "main > div",
    "[class*='section']",
    "[class*='hero']",
    "[class*='block']",
  ].join(", ");

  function detectType(cls: string): string {
    const lower = cls.toLowerCase();
    for (const t of ["hero", "testimonial", "pricing", "faq", "team", "cta", "feature", "contact", "about", "program"]) {
      if (lower.includes(t)) return t;
    }
    return "section";
  }

  const sections: string[] = [];

  $(SECTION_SELECTORS).each((_, el) => {
    const $el = $(el);
    const cls = $el.attr("class") ?? "";
    const type = detectType(cls);
    const items: string[] = [];

    // Headings — preserve tag and first meaningful class
    $el.find("h1, h2, h3, h4, h5, h6").each((_, child) => {
      const text = $(child).text().replace(/\s+/g, " ").trim();
      if (!text || text.length < 3 || text.length > 200) return;
      const tag = child.tagName.toLowerCase();
      const childCls = ($(child).attr("class") ?? "").split(/\s+/)
        .find(c => c.length > 2 && !/^w-|^col-|^row/.test(c)) ?? "";
      items.push(`  - ${tag}${childCls ? `.${childCls}` : ""}: "${text}"`);
    });

    // First 3 meaningful paragraphs
    let pCount = 0;
    $el.find("p").each((_, child) => {
      if (pCount >= 3) return;
      const text = $(child).text().replace(/\s+/g, " ").trim();
      if (text && text.length > 20 && text.length < 400) {
        items.push(`  - p: "${text}"`);
        pCount++;
      }
    });

    if (items.length > 0) {
      sections.push(`- ${type}:\n${items.join("\n")}`);
    }
  });

  // Fallback: if no sections matched (unusual HTML structure), extract headings
  // and paragraphs directly from body so every page produces some outline.
  if (sections.length === 0) {
    const items: string[] = [];
    $("body").find("h1, h2, h3").slice(0, 8).each((_, child) => {
      const text = $(child).text().replace(/\s+/g, " ").trim();
      if (text && text.length > 2 && text.length < 200) {
        items.push(`  - ${child.tagName.toLowerCase()}: "${text}"`);
      }
    });
    let pCount = 0;
    $("body").find("p").each((_, child) => {
      if (pCount >= 3) return;
      const text = $(child).text().replace(/\s+/g, " ").trim();
      if (text && text.length > 20 && text.length < 400) {
        items.push(`  - p: "${text}"`);
        pCount++;
      }
    });
    if (items.length > 0) {
      sections.push(`- page:\n${items.join("\n")}`);
    }
  }

  return sections.join("\n");
}

export async function loadActiveTransforms(
  db: Kysely<DB>,
  siteUuid: string,
): Promise<SiteTransformRecord[]> {
  const rows = await db
    .selectFrom("siteTransforms")
    .select(["uuid", "ordinal", "type", "pageGlob", "selector", "payload", "status"])
    .where("siteUuid", "=", siteUuid)
    .where("status", "=", "active")
    .orderBy("ordinal", "asc")
    .execute();
  return rows.map((r) => ({
    uuid: r.uuid,
    ordinal: r.ordinal,
    type: r.type as TransformType,
    pageGlob: r.pageGlob,
    selector: r.selector,
    payload: r.payload,
    status: r.status as SiteTransformRecord["status"],
  }));
}

export async function markStaleTransforms(db: Kysely<DB>, uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  await db
    .updateTable("siteTransforms")
    .set({ status: "stale", updatedAt: new Date() })
    .where("uuid", "in", uuids)
    .execute();
}

export interface DeployDeps {
  db: Kysely<DB>;
  s3Client: S3Client;
  bucket: string;
  siteUuid: string;
  deployId: string;
  host: string;
  preview: boolean;
  publicUrl: (key: string) => string;
  log: { info: (o: object, m: string) => void };
}

export interface DeployResult {
  deployPrefix: string;
  previewUrl: string;
  applied: string[];
  stale: string[];
  pageCount: number;
  warnings: string[];
}

const NOINDEX_TRANSFORM: SiteTransformRecord = {
  uuid: "synthetic-noindex",
  ordinal: -1,
  type: "head-inject",
  pageGlob: "/*",
  selector: null,
  payload: { html: '<meta name="robots" content="noindex">' },
  status: "active",
};

function makeInterceptorTransforms(siteUuid: string): SiteTransformRecord[] {
  return [
    {
      uuid: "synthetic-interceptor",
      ordinal: 0,
      type: "head-inject" as TransformType,
      pageGlob: "/*",
      selector: null,
      payload: {
        html: `<script src="/_assets/milo-forms.js" data-site-uuid="${siteUuid}" defer></script>`,
      },
      status: "active" as const,
    },
    {
      uuid: "synthetic-form-fallback",
      ordinal: 1,
      type: "form-route" as TransformType,
      pageGlob: "/*",
      selector: "form",
      payload: { action: `/api/forms/${siteUuid}/fallback` },
      status: "active" as const,
    },
  ];
}

const SYNTHETIC_IDS = new Set([
  "synthetic-noindex",
  "synthetic-interceptor",
  "synthetic-form-fallback",
]);

export async function deploySnapshot(
  snapshot: MirrorSnapshotArtifact,
  deps: DeployDeps,
): Promise<DeployResult> {
  const deployPrefix = `sites/${deps.siteUuid}/deploys/${deps.deployId}`;
  const dbTransforms = await loadActiveTransforms(deps.db, deps.siteUuid);
  const interceptorTransforms = makeInterceptorTransforms(deps.siteUuid);
  const transforms = deps.preview
    ? [NOINDEX_TRANSFORM, ...interceptorTransforms, ...dbTransforms]
    : [...interceptorTransforms, ...dbTransforms];
  const pageReplaces = dbTransforms.filter((t) => t.type === "page-replace");

  const applied = new Set<string>();
  const stale = new Set<string>();
  const warnings: string[] = [];

  const DEPLOY_CONCURRENCY = 12;
  const pages = snapshot.pages;

  await bounded(pages, DEPLOY_CONCURRENCY, async (page) => {
    const fileKey = pathToFileKey(page.path);
    const replace = pageReplaces.find((t) => pageGlobMatches(t.pageGlob, page.path));

    if (replace) {
      // I4: validate artifactRef before using it
      const ref =
        replace.payload !== null &&
        typeof replace.payload === "object" &&
        "artifactRef" in (replace.payload as object)
          ? (replace.payload as Record<string, unknown>).artifactRef
          : undefined;

      if (typeof ref !== "string" || !ref) {
        warnings.push(`page-replace on ${page.path} has invalid artifactRef — skipped`);
        stale.add(replace.uuid);
        return;
      }

      try {
        if (deps.preview) {
          // C1: In preview, inject noindex even into page-replace artifacts — never
          // skip the noindex guarantee just because a page comes from a replacement.
          const raw = await deps.s3Client.send(
            new GetObjectCommand({ Bucket: deps.bucket, Key: ref as string }),
          );
          const replaceHtml = (await raw.Body?.transformToString()) ?? "";
          if (!replaceHtml) {
            warnings.push(`page-replace artifact empty for ${page.path} — skipped`);
            stale.add(replace.uuid);
            return;
          }
          const result = applyTransforms(replaceHtml, page.path, [NOINDEX_TRANSFORM]);
          await deps.s3Client.send(
            new PutObjectCommand({
              Bucket: deps.bucket,
              Key: `${deployPrefix}/${fileKey}`,
              Body: Buffer.from(result.html, "utf8"),
              ContentType: "text/html; charset=utf-8",
            }),
          );
        } else {
          await deps.s3Client.send(
            new CopyObjectCommand({
              Bucket: deps.bucket,
              CopySource: `${deps.bucket}/${ref}`,
              Key: `${deployPrefix}/${fileKey}`,
            }),
          );
        }
        applied.add(replace.uuid);
      } catch (err) {
        warnings.push(`page-replace failed for ${page.path}: ${err instanceof Error ? err.message : String(err)}`);
        stale.add(replace.uuid);
      }
      return;
    }

    // Normal path: read snapshot HTML, apply transforms, upload (I1: per-page try/catch)
    let html: string;
    try {
      const raw = await deps.s3Client.send(
        new GetObjectCommand({ Bucket: deps.bucket, Key: page.htmlKey }),
      );
      html = (await raw.Body?.transformToString()) ?? "";
    } catch (err) {
      warnings.push(`deploy read failed: ${page.path} (${err instanceof Error ? err.message : String(err)})`);
      return;
    }

    // I2: empty body means the snapshot object is corrupt — skip rather than deploy a blank page
    if (!html) {
      warnings.push(`deploy skipped empty snapshot for ${page.path}`);
      return;
    }

    try {
      const result = applyTransforms(html, page.path, transforms);
      for (const u of result.applied) applied.add(u);
      for (const u of result.stale) stale.add(u);

      // Derive outline key from page.path — always distinct from the HTML key
      // even for paths like /about.html where fileKey has no index.html suffix.
      const outlineKey = `${deployPrefix}/${pathToOutlineKey(page.path)}`;

      // Extract outline defensively so a cheerio failure never blocks the HTML upload.
      let outline = "";
      try { outline = extractContentOutline(result.html); }
      catch (err) { warnings.push(`outline extraction failed: ${page.path} (${err instanceof Error ? err.message : String(err)})`); }

      const uploads: Promise<unknown>[] = [
        deps.s3Client.send(new PutObjectCommand({
          Bucket: deps.bucket,
          Key: `${deployPrefix}/${fileKey}`,
          Body: Buffer.from(result.html, "utf8"),
          ContentType: "text/html; charset=utf-8",
        })),
      ];
      if (outline) {
        uploads.push(deps.s3Client.send(new PutObjectCommand({
          Bucket: deps.bucket,
          Key: outlineKey,
          Body: Buffer.from(outline, "utf8"),
          ContentType: "text/plain; charset=utf-8",
        })));
      }
      // Save hero image URL so the generate stage can use it as backgroundImageUrl
      let heroImageUrl = "";
      try { heroImageUrl = extractHeroImageUrl(result.html) ?? ""; }
      catch { /* non-fatal */ }
      if (heroImageUrl) {
        const heroImageKey = `${deployPrefix}/${pathToOutlineKey(page.path).replace("outline.txt", "hero-image.txt")}`;
        uploads.push(deps.s3Client.send(new PutObjectCommand({
          Bucket: deps.bucket,
          Key: heroImageKey,
          Body: Buffer.from(heroImageUrl, "utf8"),
          ContentType: "text/plain; charset=utf-8",
        })));
      }
      // Save nav structure from the homepage — read by generate stage as source of truth
      if (page.path === "/" || page.path === "") {
        try {
          const origin = deps.host ? `https://${deps.host}` : "https://example.com";
          const navItems = extractNavStructure(result.html, origin);
          if (navItems.length > 0) {
            uploads.push(deps.s3Client.send(new PutObjectCommand({
              Bucket: deps.bucket,
              Key: `${deployPrefix}/nav-structure.json`,
              Body: Buffer.from(JSON.stringify(navItems, null, 2), "utf8"),
              ContentType: "application/json; charset=utf-8",
            })));
          }
        } catch { /* non-fatal */ }
      }
      await Promise.all(uploads);
    } catch (err) {
      warnings.push(`deploy write failed: ${page.path} (${err instanceof Error ? err.message : String(err)})`);
    }
  }); // end bounded page loop

  // I3: page-replace transforms that matched no page in this snapshot are stale
  for (const pr of pageReplaces) {
    if (!applied.has(pr.uuid)) stale.add(pr.uuid);
  }

  // Assets: server-side copy from snapshot prefix (parallel)
  try {
    const assetKeys: string[] = [];
    let token: string | undefined;
    do {
      const listed = await deps.s3Client.send(
        new ListObjectsV2Command({
          Bucket: deps.bucket,
          Prefix: `${snapshot.s3Prefix}/assets/`,
          ContinuationToken: token,
        }),
      );
      for (const obj of listed.Contents ?? []) {
        if (obj.Key) assetKeys.push(obj.Key);
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);

    await bounded(assetKeys, 20, async (key) => {
      const name = key.slice(`${snapshot.s3Prefix}/assets/`.length);
      await deps.s3Client.send(
        new CopyObjectCommand({
          Bucket: deps.bucket,
          CopySource: `${deps.bucket}/${key}`,
          Key: `${deployPrefix}/_assets/${name}`,
        }),
      );
    });
  } catch (err) {
    warnings.push(`asset copy failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Upload the interceptor script alongside the site assets
  try {
    await deps.s3Client.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: `${deployPrefix}/_assets/milo-forms.js`,
        Body: Buffer.from(INTERCEPTOR_SCRIPT, "utf8"),
        ContentType: "application/javascript; charset=utf-8",
      }),
    );
  } catch (err) {
    warnings.push(`interceptor upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Redirect pages for captured origin redirects
  const pagePaths = new Set(snapshot.pages.map((p) => p.path));
  for (const redirect of snapshot.redirects) {
    if (pagePaths.has(redirect.from)) continue;
    try {
      await deps.s3Client.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: `${deployPrefix}/${pathToFileKey(redirect.from)}`,
          Body: Buffer.from(buildRedirectHtml(redirect.to), "utf8"),
          ContentType: "text/html; charset=utf-8",
        }),
      );
    } catch (err) {
      warnings.push(`redirect write failed: ${redirect.from} (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // C2: Preview robots.txt blocks all crawlers; no sitemap to avoid inviting indexers.
  // Production emits a permissive robots.txt and full sitemap.
  if (deps.preview) {
    await deps.s3Client.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: `${deployPrefix}/robots.txt`,
        Body: Buffer.from("User-agent: *\nDisallow: /\n", "utf8"),
        ContentType: "text/plain",
      }),
    );
  } else {
    const sitemap = generateSitemap(deps.host, snapshot.pages.map((p) => p.path));
    await deps.s3Client.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: `${deployPrefix}/sitemap.xml`,
        Body: Buffer.from(sitemap, "utf8"),
        ContentType: "application/xml",
      }),
    );
    await deps.s3Client.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: `${deployPrefix}/robots.txt`,
        Body: Buffer.from(generateRobots(deps.host), "utf8"),
        ContentType: "text/plain",
      }),
    );
  }

  const staleToMark = [...stale].filter((u) => !SYNTHETIC_IDS.has(u));
  await markStaleTransforms(deps.db, staleToMark);

  const previewUrl = deps.publicUrl(`${deployPrefix}/index.html`);
  deps.log.info({ deployPrefix, previewUrl, stale: stale.size, warnings: warnings.length }, "mirror deploy complete");
  return {
    deployPrefix,
    previewUrl,
    applied: [...applied].filter((u) => !SYNTHETIC_IDS.has(u)),
    stale: [...stale].filter((u) => !SYNTHETIC_IDS.has(u)),
    pageCount: snapshot.pages.length,
    warnings,
  };
}

export async function promoteDeploy(
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
  deployPrefix: string,
): Promise<void> {
  const currentPrefix = `sites/${siteUuid}/staging`;

  // Collect the set of relative paths in the new deploy
  const deployRelPaths = new Set<string>();
  for (let tok: string | undefined = undefined; ; ) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${deployPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (obj.Key) deployRelPaths.add(obj.Key.slice(deployPrefix.length + 1));
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }

  // C3: Delete stale pages from staging — but NEVER delete assets.
  // Assets (images, fonts, CSS) pulled from gym sites are permanent; they are
  // tracked in the DB and must only be removed via an explicit paired operation
  // that removes both the S3 object and the DB record together.
  for (let tok: string | undefined = undefined; ; ) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${currentPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(currentPrefix.length + 1);
      if (rel.startsWith("_assets/")) continue; // never delete assets
      if (!deployRelPaths.has(rel)) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      }
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }

  // Copy all new deploy objects to staging/
  for (let tok: string | undefined = undefined; ; ) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${deployPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(deployPrefix.length + 1);
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${obj.Key}`,
          Key: `${currentPrefix}/${rel}`,
        }),
      );
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }
}

/**
 * Copy staging/ → production/ so the published version goes live.
 * Same copy+orphan-delete pattern as promoteDeploy.
 */
export async function publishToProduction(
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
): Promise<void> {
  const stagingPrefix = `sites/${siteUuid}/staging`;
  const productionPrefix = `sites/${siteUuid}/production`;

  // Collect all objects in staging
  const stagingPaths = new Set<string>();
  for (let tok: string | undefined = undefined; ;) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${stagingPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (obj.Key) stagingPaths.add(obj.Key.slice(stagingPrefix.length + 1));
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }

  // Delete stale pages in production absent from staging — but NEVER delete assets.
  // Assets are permanent; paired S3+DB removal must go through an explicit admin operation.
  for (let tok: string | undefined = undefined; ;) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${productionPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(productionPrefix.length + 1);
      if (rel.startsWith("_assets/")) continue; // never delete assets
      if (!stagingPaths.has(rel)) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      }
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }

  // Copy staging → production
  for (let tok: string | undefined = undefined; ;) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${stagingPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(stagingPrefix.length + 1);
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${obj.Key}`,
          Key: `${productionPrefix}/${rel}`,
        }),
      );
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }
}
