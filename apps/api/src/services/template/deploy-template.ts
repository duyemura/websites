import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { loadArtifact } from "../../utils/pipeline/artifact-store";
import { buildRedirectHtml } from "../../utils/mirror/site-meta";
import { pathToFileKey } from "../mirror/snapshot";
import { computeRedirects } from "../../utils/template/redirects";
import { recordSiteVersion } from "../site-versions";
import { discoverRoutes, walk } from "../../utils/template/route-discovery.js";
import type { MirrorCrawlArtifact } from "../../types/mirror";
import type { PipelineStage } from "../../types/pipeline-artifacts";
import type { Config } from "../../plugins/env";

const RETRYABLE_S3_CODES = new Set([
  "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE",
  "ERR_SOCKET_CONNECTION_TIMEOUT", "TimeoutError", "RequestTimeout",
]);
const MAX_S3_ATTEMPTS = 5;

async function sendWithRetry<T>(
  client: S3Client,
  command: unknown,
  attempt = 1,
  onRetry?: (err: unknown, attempt: number) => void,
): Promise<T> {
  try {
    return (await client.send(command as Parameters<S3Client["send"]>[0])) as T;
  } catch (err) {
    const code = (err as { code?: string; name?: string }).code ?? (err as { name?: string }).name ?? "";
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const retryable =
      attempt < MAX_S3_ATTEMPTS &&
      (RETRYABLE_S3_CODES.has(code) || (status !== undefined && status >= 500));
    if (!retryable) throw err;
    if (onRetry) onRetry(err, attempt);
    const delay = Math.min(500 * 2 ** (attempt - 1), 10_000);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return sendWithRetry(client, command, attempt + 1, onRetry);
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";


export interface TemplateLocalBuildInput {
  rendererDir: string;
  /** The validated GymSiteContent object to build with. If omitted, buildGymJson is called automatically. */
  gymJson?: unknown;
  siteUuid?: string;
  workspaceUuid?: string;
  templateTheme?: "baseline" | "impact" | "beanburito";
  log?: { info: (o: object, m: string) => void; warn?: (o: object, m: string) => void };
}

export interface DeployTemplateDistInput {
  db: Kysely<DB>;
  s3Client: S3Client;
  bucket: string;
  siteUuid: string;
  workspaceUuid: string;
  /** Absolute path to apps/renderer/dist (already built). */
  distDir: string;
  /** Optional override for the theme. If omitted, uses whatever was built into gym.json. */
  templateTheme?: "baseline" | "impact" | "beanburito";
  label?: string;
  log: { info: (o: object, m: string) => void; warn?: (o: object, m: string) => void };
}

export interface DeployTemplateInput {
  db: Kysely<DB>;
  s3Client: S3Client;
  bucket: string;
  siteUuid: string;
  workspaceUuid: string;
  /** The validated GymSiteContent object to build with. If omitted, buildGymJson is called automatically. */
  content?: unknown;
  /** Override the Astro template theme. Defaults to auto-detected baseline/impact. */
  templateTheme?: "baseline" | "impact" | "beanburito";
  /** API base URL forwarded to the content mapper (e.g. CDN_BASE_URL). */
  apiBaseUrl?: string;
  /** Public site URL forwarded to the content mapper. */
  siteUrl?: string;
  /** Google Maps API key forwarded to the content mapper for embed URL generation. */
  googleMapsApiKey?: string;
  /** App config forwarded to the content mapper for LLM-backed features (service-area inference). */
  appConfig?: Config;
  /** Absolute path to apps/renderer. */
  rendererDir: string;
  label?: string;
  log: { info: (o: object, m: string) => void; warn?: (o: object, m: string) => void };
}

async function resolveGymJson(
  input: Pick<DeployTemplateInput, "db" | "siteUuid" | "workspaceUuid" | "apiBaseUrl" | "siteUrl" | "googleMapsApiKey" | "appConfig" | "content" | "templateTheme" | "log">,
): Promise<unknown> {
  const { db, siteUuid, workspaceUuid, log } = input;
  let gymJson = input.content;
  if (!gymJson) {
    if (!db || !siteUuid || !workspaceUuid) {
      throw new Error("resolveGymJson requires db, siteUuid, and workspaceUuid when content is not provided");
    }
    const { buildGymJson } = await import("./content-mapper.js");
    const { content: mapped, warnings } = await buildGymJson(db, siteUuid, {
      apiBaseUrl: input.apiBaseUrl ?? "",
      siteUrl: input.siteUrl ?? "",
      googleMapsApiKey: input.googleMapsApiKey,
      appConfig: input.appConfig,
    }, workspaceUuid);
    if (warnings.length > 0) {
      (log?.warn ?? log?.info ?? (() => undefined))({ siteUuid, warnings }, "content mapper used defaults");
    }
    gymJson = mapped;
  }
  // Backfill a Google Maps embed URL from the business name + address. The classic
  // output=embed endpoint works without an API key, so we prefer it over the
  // Maps Embed API v1 endpoint that fails when the key hasn't been activated.
  if (gymJson && typeof gymJson === "object") {
    const business = (gymJson as Record<string, unknown>).business as Record<string, unknown> | undefined;
    if (business) {
      const mapUrl = business.mapEmbedUrl;
      const shouldReplace =
        typeof mapUrl !== "string" ||
        mapUrl.length === 0 ||
        mapUrl.includes("/embed/v1/place");
      const address = business.address as { street?: string; city?: string; zip?: string } | undefined;
      const geo = business.geo as { stateAbbr?: string } | undefined;
      const name = business.name as string | undefined;
      if (shouldReplace && name && address?.street && geo?.stateAbbr) {
        const q = encodeURIComponent(
          `${name}, ${address.street}, ${address.city}, ${geo.stateAbbr} ${address.zip}`,
        );
        business.mapEmbedUrl = `https://www.google.com/maps?q=${q}&output=embed`;
      }
    }
  }

  if (input.templateTheme && gymJson && typeof gymJson === "object") {
    (gymJson as Record<string, unknown>).meta = {
      ...((gymJson as Record<string, unknown>).meta as object),
      templateTheme: input.templateTheme,
    };
  }

  return gymJson;
}

/**
 * Build the Astro renderer locally without uploading to S3. Use this inside an
 * eval-fix loop so each iteration is cheap and doesn't touch CloudFront/KVS.
 */
export async function buildTemplateLocal(input: TemplateLocalBuildInput): Promise<void> {
  const { rendererDir, gymJson } = input;
  await fs.writeFile(path.join(rendererDir, "src/content/gym.json"), JSON.stringify(gymJson, null, 2));
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["build"], { cwd: rendererDir, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`astro build exited ${code}`))));
    child.on("error", reject);
  });
}

export async function deployTemplate(input: DeployTemplateInput) {
  const { db, s3Client, bucket, siteUuid, workspaceUuid, rendererDir, log } = input;

  // 1. Resolve content — use provided value or fall back to the content mapper
  const gymJson = await resolveGymJson(input);

  // 2. Build locally
  await buildTemplateLocal({ rendererDir, gymJson, siteUuid, workspaceUuid, templateTheme: input.templateTheme, log });

  // 3. Upload the already-built dist
  return deployTemplateDist({
    db, s3Client, bucket, siteUuid, workspaceUuid,
    distDir: path.join(rendererDir, "dist"),
    templateTheme: input.templateTheme,
    label: input.label,
    log,
  });
}

/**
 * Upload an already-built Astro dist/ to S3 and record a template version.
 * Use this after a local eval-fix loop converges so we don't rebuild again.
 */
export async function deployTemplateDist(input: DeployTemplateDistInput) {
  const { db, s3Client, bucket, siteUuid, workspaceUuid, distDir, log } = input;

  const deployPrefix = `sites/${siteUuid}/deploys/tpl-${Date.now()}`;
  const files = await walk(distDir);
  for (const file of files) {
    const rel = path.relative(distDir, file).split(path.sep).join("/");
    await sendWithRetry(
      s3Client,
      new PutObjectCommand({
        Bucket: bucket, Key: `${deployPrefix}/${rel}`,
        Body: await fs.readFile(file), ContentType: mimeFor(file),
      }),
      1,
      (err, attempt) => log.warn?.({ err, attempt, file: rel }, `S3 upload retry for ${rel}`),
    );
  }
  log.info({ deployPrefix, fileCount: files.length }, "template dist uploaded");

  // Redirect map: old source URLs that no longer exist → redirect pages
  const crawl =
    (await loadArtifact<MirrorCrawlArtifact>(db, { siteUuid, workspaceUuid }, "crawl")) ??
    (await loadArtifact<MirrorCrawlArtifact>(db, { siteUuid, workspaceUuid }, "mirror-crawl" as PipelineStage));
  const oldPaths = crawl?.payload.pages.map((p) => p.path) ?? [];
  const newRoutes = await discoverRoutes(distDir);
  const redirects = computeRedirects(oldPaths, newRoutes);
  for (const r of redirects) {
    await sendWithRetry(
      s3Client,
      new PutObjectCommand({
        Bucket: bucket, Key: `${deployPrefix}/${pathToFileKey(r.from)}`,
        Body: Buffer.from(buildRedirectHtml(r.to), "utf8"),
        ContentType: "text/html; charset=utf-8",
      }),
      1,
      (err, attempt) => log.warn?.({ err, attempt, from: r.from }, `S3 redirect upload retry for ${r.from}`),
    );
  }
  log.info({ redirects: redirects.length }, "redirect pages written");

  // Record the version (publish is a separate, explicit call)
  const version = await recordSiteVersion(db, {
    siteUuid, workspaceUuid, kind: "template", deployPrefix,
    label: input.label ?? "Template build",
  });

  return { version: version.version, deployPrefix, routes: newRoutes.length, redirects };
}
