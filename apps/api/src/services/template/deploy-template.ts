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
import type { MirrorCrawlArtifact } from "../../types/mirror";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : Promise.resolve([full]);
  }));
  return files.flat();
}

/** dist file → route ("index.html" → "/", "about/index.html" → "/about") */
function fileToRoute(rel: string): string | null {
  if (!rel.endsWith("index.html")) return null;
  const p = "/" + rel.slice(0, -"index.html".length).replace(/\/$/, "");
  return p === "" ? "/" : p === "/" ? "/" : p.replace(/\/$/, "");
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
  /** Absolute path to apps/renderer. */
  rendererDir: string;
  label?: string;
  log: { info: (o: object, m: string) => void; warn?: (o: object, m: string) => void };
}

export async function deployTemplate(input: DeployTemplateInput) {
  const { db, s3Client, bucket, siteUuid, workspaceUuid, rendererDir, log } = input;

  // 1. Resolve content — use provided value or fall back to the content mapper
  let gymJson = input.content;
  if (!gymJson) {
    const { buildGymJson } = await import("./content-mapper.js");
    const { content: mapped, warnings } = await buildGymJson(db, siteUuid, {
      apiBaseUrl: input.apiBaseUrl ?? "",
      siteUrl: input.siteUrl ?? "",
    }, workspaceUuid);
    if (warnings.length > 0) {
      (log.warn ?? log.info)({ siteUuid, warnings }, "content mapper used defaults");
    }
    gymJson = mapped;
  }
  if (input.templateTheme && gymJson && typeof gymJson === "object") {
    (gymJson as Record<string, unknown>).meta = {
      ...((gymJson as Record<string, unknown>).meta as object),
      templateTheme: input.templateTheme,
    };
  }

  // 2. Inject content + build
  await fs.writeFile(path.join(rendererDir, "src/content/gym.json"), JSON.stringify(gymJson, null, 2));
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["build"], { cwd: rendererDir, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`astro build exited ${code}`))));
    child.on("error", reject);
  });

  // 3. Upload dist to an immutable prefix
  const deployPrefix = `sites/${siteUuid}/deploys/tpl-${Date.now()}`;
  const distDir = path.join(rendererDir, "dist");
  const files = await walk(distDir);
  for (const file of files) {
    const rel = path.relative(distDir, file).split(path.sep).join("/");
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket, Key: `${deployPrefix}/${rel}`,
      Body: await fs.readFile(file), ContentType: mimeFor(file),
    }));
  }
  log.info({ deployPrefix, fileCount: files.length }, "template dist uploaded");

  // 4. Redirect map: old mirror URLs that no longer exist → redirect pages
  const crawl = await loadArtifact<MirrorCrawlArtifact>(db, { siteUuid, workspaceUuid }, "mirror-crawl");
  const oldPaths = crawl?.payload.pages.map((p) => p.path) ?? [];
  const newRoutes = files
    .map((f) => fileToRoute(path.relative(distDir, f).split(path.sep).join("/")))
    .filter((r): r is string => r !== null);
  const redirects = computeRedirects(oldPaths, newRoutes);
  for (const r of redirects) {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket, Key: `${deployPrefix}/${pathToFileKey(r.from)}`,
      Body: Buffer.from(buildRedirectHtml(r.to), "utf8"),
      ContentType: "text/html; charset=utf-8",
    }));
  }
  log.info({ redirects: redirects.length }, "redirect pages written");

  // 5. Record the version (publish is a separate, explicit call)
  const version = await recordSiteVersion(db, {
    siteUuid, workspaceUuid, kind: "template", deployPrefix,
    label: input.label ?? "Template build",
  });

  return { version: version.version, deployPrefix, routes: newRoutes.length, redirects };
}
