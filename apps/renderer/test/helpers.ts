import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import fixture from "../src/content/gym.fixture.json";

export const gym = fixture;
export const distPath = (p: string) => join(process.cwd(), "dist", p);
export const distExists = (p: string) => existsSync(distPath(p));
export const readDist = (p: string) => readFileSync(distPath(p), "utf8");
export const loadPage = (p: string) => cheerio.load(readDist(p));

/** All parsed JSON-LD objects on a page. Throws with location context on parse failure. */
export function jsonLd(page: ReturnType<typeof loadPage>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  page('script[type="application/ld+json"]').each((i, el) => {
    const raw = page(el).text();
    try {
      out.push(JSON.parse(raw));
    } catch (err) {
      throw new Error(
        `JSON-LD parse error on script #${i}: ${err instanceof Error ? err.message : String(err)}\nRaw (truncated): ${raw.slice(0, 200)}`,
      );
    }
  });
  return out;
}

/** Concatenated content of all emitted CSS files (for asserting utility classes are built). */
export function builtCss(): string {
  const astroDir = join(process.cwd(), "dist", "_astro");
  if (!existsSync(astroDir)) return "";
  return readdirSync(astroDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(join(astroDir, f), "utf8"))
    .join("\n");
}
