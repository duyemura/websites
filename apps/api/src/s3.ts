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

export interface S3ClientConfig {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export function getS3Client(config: S3ClientConfig): S3Client {
  if (!client) {
    const isCustomEndpoint = Boolean(config.endpoint);
    client = new S3Client({
      ...(isCustomEndpoint ? { endpoint: config.endpoint } : {}),
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      },
      forcePathStyle: isCustomEndpoint,
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

export function buildS3ObjectUrl(config: {
  endpoint?: string;
  region: string;
  bucket: string;
  key: string;
}): string {
  const encodedKey = config.key.split("/").map(encodeURIComponent).join("/");
  if (config.endpoint) {
    const base = config.endpoint.replace(/\/$/, "");
    return `${base}/${config.bucket}/${encodedKey}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodedKey}`;
}

export function createS3StorageProvider(config: {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  bucket: string;
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
      const publicUrl = buildS3ObjectUrl({
        endpoint: config.endpoint,
        region: config.region,
        bucket: config.bucket,
        key,
      });

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
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  bucket: string;
  workspaceUuid: string;
  filename: string;
  contentType?: string;
}): Promise<{ signedUrl: string; publicUrl: string; storageKey: string }> {
  const provider = createS3StorageProvider({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
    bucket: config.bucket,
  });
  return provider.getUploadUrl(config.workspaceUuid, config.filename, config.contentType);
}

export async function uploadBufferToS3(config: {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  bucket: string;
  workspaceUuid: string;
  filename: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<{ publicUrl: string; storageKey: string }> {
  const s3 = getS3Client({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
  });

  const safeFilename = path
    .basename(config.filename)
    .replace(/[\\/]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[.]+/, "");
  const key = path.posix.join(
    "workspaces",
    config.workspaceUuid,
    "assets",
    `${Date.now()}-${safeFilename || "asset"}`,
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: config.buffer,
      ContentType: config.contentType ?? "application/octet-stream",
    }),
  );

  const publicUrl = buildS3ObjectUrl({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    key,
  });
  return { publicUrl, storageKey: key };
}

export async function getSignedDownloadUrl(config: {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  bucket: string;
  key: string;
  expiresIn?: number;
}): Promise<string> {
  const s3 = getS3Client({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
  });
  const command = new GetObjectCommand({ Bucket: config.bucket, Key: config.key });
  return getSignedUrl(s3, command, { expiresIn: config.expiresIn ?? 300 });
}
