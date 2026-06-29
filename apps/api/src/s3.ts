import {
  S3Client,
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "node:path";
import type { StorageProvider, UploadUrl } from "./storage";

let client: S3Client | null = null;

export function getS3Client(config: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return client;
}

export async function ensureBuckets(
  s3: S3Client,
  buckets: string[],
): Promise<void> {
  for (const bucket of buckets) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
}

export function createS3StorageProvider(config: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  cdnBaseUrl: string;
}): StorageProvider {
  const s3 = getS3Client(config);

  return {
    async getUploadUrl(
      workspaceUuid: string,
      filename: string,
      contentType?: string,
    ): Promise<UploadUrl> {
      const safeFilename = path
        .basename(filename)
        .replace(/[\\/]/g, "_")
        .replace(/\.{2,}/g, "_")
        .replace(/^[.]+/, "");
      const key = path.posix.join(
        "workspaces",
        workspaceUuid,
        "assets",
        `${Date.now()}-${safeFilename || "asset"}`,
      );

      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType ?? "application/octet-stream",
      });

      const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
      const publicUrl = `${config.cdnBaseUrl.replace(/\/$/, "")}/${config.bucket}/${key}`;

      return { signedUrl, publicUrl, storageKey: key };
    },

    async getDownloadUrl(storageKey: string): Promise<string> {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
      });
      return getSignedUrl(s3, command, { expiresIn: 300 });
    },

    async getObjectStream(storageKey: string): Promise<NodeJS.ReadableStream> {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }),
      );
      return response.Body as NodeJS.ReadableStream;
    },

    async deleteObject(storageKey: string): Promise<void> {
      await s3.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }),
      );
    },
  };
}

export async function getAssetUploadUrl(config: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  cdnBaseUrl: string;
  workspaceUuid: string;
  filename: string;
  contentType?: string;
}): Promise<{ signedUrl: string; publicUrl: string; storageKey: string }> {
  const provider = createS3StorageProvider({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    cdnBaseUrl: config.cdnBaseUrl,
  });
  return provider.getUploadUrl(config.workspaceUuid, config.filename, config.contentType);
}
