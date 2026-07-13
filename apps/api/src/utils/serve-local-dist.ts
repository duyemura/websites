// apps/api/src/utils/serve-local-dist.ts
// Serve a static build directory over a local HTTP server for Playwright QA.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

export async function withLocalDistServer<T>(
  distDir: string,
  fn: (url: string) => Promise<T>,
): Promise<T> {
  if (!existsSync(path.join(distDir, "index.html"))) {
    throw new Error(`No build at ${distDir} — run the template stage first`);
  }

  const server = createServer((req, res) => {
    const reqPath = ((req.url ?? "/").split("?")[0] || "/") as string;
    let file = path.join(distDir, reqPath);
    if (reqPath.endsWith("/")) file = path.join(file, "index.html");
    else if (!path.extname(file)) file = path.join(file, "index.html");
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/`;

  try {
    return await fn(url);
  } finally {
    server.close();
  }
}
