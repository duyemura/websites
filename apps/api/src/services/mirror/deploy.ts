import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { applyTransforms, pageGlobMatches } from "../../utils/mirror/apply-transforms";
import { generateRobots, generateSitemap, buildRedirectHtml } from "../../utils/mirror/site-meta";
import { pathToFileKey } from "./snapshot";
import type { MirrorSnapshotArtifact, SiteTransformRecord, TransformType } from "../../types/mirror";

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

export async function deploySnapshot(
  snapshot: MirrorSnapshotArtifact,
  deps: DeployDeps,
): Promise<DeployResult> {
  const deployPrefix = `sites/${deps.siteUuid}/deploys/${deps.deployId}`;
  const dbTransforms = await loadActiveTransforms(deps.db, deps.siteUuid);
  const transforms = deps.preview ? [NOINDEX_TRANSFORM, ...dbTransforms] : dbTransforms;
  const pageReplaces = dbTransforms.filter((t) => t.type === "page-replace");

  const applied = new Set<string>();
  const stale = new Set<string>();

  for (const page of snapshot.pages) {
    const fileKey = pathToFileKey(page.path);
    const replace = pageReplaces.find((t) => pageGlobMatches(t.pageGlob, page.path));
    if (replace) {
      const ref = (replace.payload as { artifactRef: string }).artifactRef;
      await deps.s3Client.send(
        new CopyObjectCommand({
          Bucket: deps.bucket,
          CopySource: `${deps.bucket}/${ref}`,
          Key: `${deployPrefix}/${fileKey}`,
        }),
      );
      applied.add(replace.uuid);
      continue;
    }
    const raw = await deps.s3Client.send(
      new GetObjectCommand({ Bucket: deps.bucket, Key: page.htmlKey }),
    );
    const html = (await raw.Body?.transformToString()) ?? "";
    const result = applyTransforms(html, page.path, transforms);
    for (const u of result.applied) applied.add(u);
    for (const u of result.stale) stale.add(u);
    await deps.s3Client.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: `${deployPrefix}/${fileKey}`,
        Body: Buffer.from(result.html, "utf8"),
        ContentType: "text/html; charset=utf-8",
      }),
    );
  }

  // Assets: server-side copy from snapshot prefix.
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

  // Redirect pages for captured origin redirects.
  const pagePaths = new Set(snapshot.pages.map((p) => p.path));
  for (const redirect of snapshot.redirects) {
    if (pagePaths.has(redirect.from)) continue;
    await deps.s3Client.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: `${deployPrefix}/${pathToFileKey(redirect.from)}`,
        Body: Buffer.from(buildRedirectHtml(redirect.to), "utf8"),
        ContentType: "text/html; charset=utf-8",
      }),
    );
  }

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

  const staleToMark = [...stale].filter((u) => u !== "synthetic-noindex");
  await markStaleTransforms(deps.db, staleToMark);

  const previewUrl = deps.publicUrl(`${deployPrefix}/index.html`);
  deps.log.info({ deployPrefix, previewUrl, stale: stale.size }, "mirror deploy complete");
  return {
    deployPrefix,
    previewUrl,
    applied: [...applied].filter((u) => u !== "synthetic-noindex"),
    stale: [...stale],
    pageCount: snapshot.pages.length,
  };
}

export async function promoteDeploy(
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
  deployPrefix: string,
): Promise<void> {
  const currentPrefix = `sites/${siteUuid}/current`;
  let token: string | undefined;
  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${deployPrefix}/`,
        ContinuationToken: token,
      }),
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
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}
