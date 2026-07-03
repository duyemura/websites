import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export interface S3Context {
  s3: S3Client;
  bucket: string;
  endpoint?: string;
  region: string;
}

/**
 * Download an image from a URL and return a base64 data URI for LLM vision calls.
 *
 * Vision LLMs require either a publicly-accessible URL or an inline base64 data
 * URI. Since pipeline screenshots live in a private S3 bucket, we download them
 * server-side and encode them before sending.
 *
 * When an S3Context is provided and the URL matches the bucket's origin, the file
 * is downloaded via the S3 SDK (authenticated). Otherwise falls back to plain fetch
 * (works for public URLs or localhost).
 */
export async function imageUrlToDataUri(url: string, s3ctx?: S3Context): Promise<string> {
  if (url.startsWith("data:")) return url;

  if (s3ctx) {
    const key = extractS3Key(url, s3ctx);
    if (key) {
      const res = await s3ctx.s3.send(
        new GetObjectCommand({ Bucket: s3ctx.bucket, Key: key }),
      );
      const chunks: Uint8Array[] = [];
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const ct = res.ContentType ?? "image/png";
      return `data:${ct};base64,${buffer.toString("base64")}`;
    }
  }

  // Fallback: plain fetch (works for public URLs and local test servers).
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch image for LLM vision call: ${res.status} ${res.statusText} — ${url}`,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "image/png";
  return `data:${ct};base64,${buffer.toString("base64")}`;
}

/**
 * Given an S3 object URL, extract the storage key if it belongs to the
 * configured bucket. Returns null for unrelated URLs.
 */
function extractS3Key(url: string, ctx: S3Context): string | null {
  try {
    const parsed = new URL(url);
    // Endpoint-style URL: {endpoint}/{bucket}/{key}
    if (ctx.endpoint) {
      const base = ctx.endpoint.replace(/\/$/, "");
      const prefix = `${base}/${ctx.bucket}/`;
      if (url.startsWith(prefix)) {
        return decodeURIComponent(url.slice(prefix.length));
      }
    }
    // AWS-style URL: https://{bucket}.s3.{region}.amazonaws.com/{key}
    const expectedHost = `${ctx.bucket}.s3.${ctx.region}.amazonaws.com`;
    if (parsed.hostname === expectedHost) {
      return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    }
    return null;
  } catch {
    return null;
  }
}
