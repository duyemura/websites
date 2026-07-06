import { PutObjectCommand } from "@aws-sdk/client-s3";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getS3Client, buildS3ObjectUrl } from "../s3";
import type { Config } from "../plugins/env";

export interface UploadBuildArtifactsInput {
  config: Config;
  workspaceUuid: string;
  siteUuid: string;
  attemptId: string;
  pageSlug: string;
  sourceDir: string;
  distDir: string;
}

export interface BuildArtifactUrls {
  previewUrl: string;
  artifactUrl: string;
  sourcePrefix: string;
  distPrefix: string;
  s3: {
    bucket: string;
    previewKey: string;
    artifactPrefix: string;
  };
}

export async function uploadBuildArtifacts(input: UploadBuildArtifactsInput): Promise<BuildArtifactUrls> {
  const bucket = input.config.S3_DEPLOYMENTS_BUCKET;
  if (!bucket) {
    throw new Error("S3_DEPLOYMENTS_BUCKET is not configured");
  }

  const s3 = getS3Client({
    endpoint: input.config.S3_ENDPOINT,
    region: input.config.S3_REGION,
    accessKeyId: input.config.S3_ACCESS_KEY,
    secretAccessKey: input.config.S3_SECRET_KEY,
  });

  const sourcePrefix = path.posix.join("sites", input.siteUuid, "source", input.attemptId);
  const distPrefix = path.posix.join("sites", input.siteUuid, "dist", input.attemptId);

  await uploadDirectory(s3, bucket, input.sourceDir, sourcePrefix);
  await uploadDirectory(s3, bucket, input.distDir, distPrefix);

  const previewPath = input.pageSlug === "index" ? "index.html" : `${input.pageSlug}/index.html`;
  const previewKey = path.posix.join(distPrefix, previewPath);
  // Preview artifacts are public so users can open them directly in a browser.
  const previewUrl = buildS3ObjectUrl({
    endpoint: input.config.S3_ENDPOINT,
    region: input.config.S3_REGION,
    bucket,
    key: previewKey,
  });
  const artifactUrl = buildS3ObjectUrl({
    endpoint: input.config.S3_ENDPOINT,
    region: input.config.S3_REGION,
    bucket,
    key: distPrefix,
  });

  return {
    previewUrl,
    artifactUrl,
    sourcePrefix,
    distPrefix,
    s3: {
      bucket,
      previewKey,
      artifactPrefix: distPrefix,
    },
  };
}

async function uploadDirectory(
  s3: ReturnType<typeof getS3Client>,
  bucket: string,
  localDir: string,
  keyPrefix: string,
): Promise<void> {
  const entries = await readdir(localDir);
  await Promise.all(
    entries
      .filter((entry) => entry !== "node_modules" && entry !== ".git")
      .map(async (entry) => {
        const localPath = path.join(localDir, entry);
        const info = await stat(localPath);
        const key = path.posix.join(keyPrefix, entry);
        if (info.isDirectory()) {
          return uploadDirectory(s3, bucket, localPath, key);
        }
        const body = await readFile(localPath);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentTypeForPath(localPath),
          }),
        );
      }),
  );
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".css":
      return "text/css";
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}
