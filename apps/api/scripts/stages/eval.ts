// apps/api/scripts/stages/eval.ts
// `milo eval` runs the standalone per-page QA evaluator.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { perPageEvalStage } from "./per-page-eval.js";
import type { StageRunner, StageContext, StageResult } from "./types";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

// Default no-options runner used by the registry-driven upgrade pipeline.
// Evaluates the freshly built Astro dist locally so post-publish QA is not
// blocked by CloudFront/KVS propagation delays.
export const evalStage: StageRunner = {
  label: "Per-page QA eval (local dist)",
  requires: [],
  produces: "",
  async run(ctx: StageContext): Promise<StageResult> {
    const distDir = path.join(ctx.rendererDir, "dist");
    if (!existsSync(path.join(distDir, "index.html"))) {
      return {
        stage: "eval",
        status: "fail",
        durationMs: 0,
        metrics: {},
        warnings: [],
        error: `No build at ${distDir} — run the template stage first`,
      };
    }

    const server = createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      let file = path.join(distDir, url);
      if (url.endsWith("/")) file = path.join(file, "index.html");
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
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const localUrl = `http://127.0.0.1:${port}/`;

    try {
      const runner = perPageEvalStage({ path: "/", url: localUrl });
      return await runner.run(ctx);
    } finally {
      server.close();
    }
  },
};
