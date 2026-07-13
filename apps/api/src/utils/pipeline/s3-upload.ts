import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { buildS3ObjectUrl } from "../../s3";
import type { Config } from "../../plugins/env";

/**
 * Uploads a raw buffer (screenshot / interaction image) to the assets S3 bucket
 * and returns the public URL.
 *
 * Mirrors the PutObjectCommand + buildS3ObjectUrl pattern used by the site
 * scrape route so pipeline stages and legacy scrape code stay in sync.
 */
export async function uploadPipelineImage(
  s3: S3Client,
  config: Config,
  key: string,
  body: Buffer,
  contentType: string = "image/png",
  options?: { publicRead?: boolean },
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_ASSETS_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "no-store, no-cache, must-revalidate, max-age=0",
      // Public read is handled by the bucket policy — no per-object ACL needed.
    }),
  );
  return buildS3ObjectUrl({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_ASSETS_BUCKET,
    key,
  });
}
