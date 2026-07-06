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

/**
 * Extract a semantic content outline from page HTML.
 * Preserves heading hierarchy and section context so LLMs can map
 * content to template slots without raw HTML noise.
 */
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

  // Process pages in chunks to avoid OOM on large sites (500+ pages).
  const CHUNK_SIZE = 50;
  const pages = snapshot.pages;
  for (let chunkStart = 0; chunkStart < pages.length; chunkStart += CHUNK_SIZE) {
    const chunk = pages.slice(chunkStart, chunkStart + CHUNK_SIZE);
    if (chunkStart > 0) await new Promise<void>((r) => setTimeout(r, 0)); // yield for GC
    for (const page of chunk) {
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
        continue;
      }

      try {
        if (deps.preview) {
          // C1: In preview, inject noindex even into page-replace artifacts — never
          // skip the noindex guarantee just because a page comes from a replacement.
          const raw = await deps.s3Client.send(
            new GetObjectCommand({ Bucket: deps.bucket, Key: ref }),
          );
          const html = (await raw.Body?.transformToString()) ?? "";
          if (!html) {
            warnings.push(`page-replace artifact empty for ${page.path} — skipped`);
            stale.add(replace.uuid);
            continue;
          }
          const result = applyTransforms(html, page.path, [NOINDEX_TRANSFORM]);
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
      continue;
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
      continue;
    }

    // I2: empty body means the snapshot object is corrupt — skip rather than deploy a blank page
    if (!html) {
      warnings.push(`deploy skipped empty snapshot for ${page.path}`);
      continue;
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
      await Promise.all(uploads);
    } catch (err) {
      warnings.push(`deploy write failed: ${page.path} (${err instanceof Error ? err.message : String(err)})`);
    }
    } // end inner page loop
  } // end chunk loop

  // I3: page-replace transforms that matched no page in this snapshot are stale
  for (const pr of pageReplaces) {
    if (!applied.has(pr.uuid)) stale.add(pr.uuid);
  }

  // Assets: server-side copy from snapshot prefix
  try {
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
        if (!obj.Key) continue;
        const name = obj.Key.slice(`${snapshot.s3Prefix}/assets/`.length);
        await deps.s3Client.send(
          new CopyObjectCommand({
            Bucket: deps.bucket,
            CopySource: `${deps.bucket}/${obj.Key}`,
            Key: `${deployPrefix}/_assets/${name}`,
          }),
        );
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
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

  // C3: Delete objects in current/ absent from the new deploy (stale page cleanup)
  for (let tok: string | undefined = undefined; ; ) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${currentPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(currentPrefix.length + 1);
      if (!deployRelPaths.has(rel)) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      }
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }

  // Copy all new deploy objects to current/
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

  // Delete objects in production/ absent from staging (stale cleanup)
  for (let tok: string | undefined = undefined; ;) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${productionPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(productionPrefix.length + 1);
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
