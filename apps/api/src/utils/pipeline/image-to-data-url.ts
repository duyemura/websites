/**
 * Download an image from a URL (including private S3 URLs via the AWS SDK or
 * plain HTTPS) and return a data URI suitable for LLM vision calls.
 *
 * Vision models require publicly-accessible URLs or inline base64 data URIs.
 * Since our pipeline stores screenshots in a private S3 bucket, we fetch them
 * server-side and encode them as data URIs before forwarding to the LLM.
 */
export async function imageUrlToDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url; // already a data URI
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image for LLM vision call: ${res.status} ${res.statusText} — ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "image/png";
  return `data:${ct};base64,${buffer.toString("base64")}`;
}
