// apps/api/src/utils/template/route-discovery.ts
// Discover the public page routes present in a built Astro dist directory.
// Mirrors the route logic in deploy-template.ts so eval and QA stages see exactly
// the same set of pages that will be uploaded.

import { promises as fs } from "node:fs";
import path from "node:path";

/** dist file → route ("index.html" → "/", "about/index.html" → "/about") */
export function fileToRoute(rel: string): string | null {
  if (!rel.endsWith("index.html")) return null;
  const p = "/" + rel.slice(0, -"index.html".length).replace(/\/$/, "");
  return p === "" ? "/" : p === "/" ? "/" : p.replace(/\/$/, "");
}

export async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(full);
      }
      return [full];
    }),
  );
  return nested.flat();
}

/**
 * Return every route represented by an index.html file under `distDir`.
 * Excludes non-HTML files, 404.html, and dynamic asset directories like _astro/.
 */
export async function discoverRoutes(distDir: string): Promise<string[]> {
  const files = await walk(distDir);
  return files
    .map((file) => path.relative(distDir, file).split(path.sep).join("/"))
    .map(fileToRoute)
    .filter((r): r is string => r !== null)
    .sort();
}
