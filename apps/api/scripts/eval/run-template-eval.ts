/**
 * Template eval — build-quality gate for the Astro template.
 * Usage (from apps/api/): pnpm tsx scripts/eval/run-template-eval.ts [--dist ../renderer/dist]
 * Precondition: the renderer has been built (cd ../renderer && pnpm test builds it, or pnpm use:fixture && pnpm build).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".xml": "application/xml",
  ".txt": "text/plain", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

function argOr(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const distDir = path.resolve(process.cwd(), argOr("dist", "../renderer/dist"));
  if (!existsSync(path.join(distDir, "index.html"))) {
    console.error(`No build at ${distDir} — run: cd ../renderer && pnpm use:fixture && pnpm build`);
    process.exit(1);
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
      res.writeHead(404); res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const failures: string[] = [];
  const visited = new Set<string>();
  const queue = ["/"];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  while (queue.length > 0) {
    const route = queue.shift()!;
    if (visited.has(route)) continue;
    visited.add(route);

    const res = await page.goto(base + route, { waitUntil: "domcontentloaded" });
    if (!res || res.status() >= 400) { failures.push(`${route}: HTTP ${res?.status()}`); continue; }

    // JSON-LD must parse on every page
    const ldErrors = await page.evaluate(() => {
      const errs: string[] = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s, i) => {
        try { JSON.parse(s.textContent ?? ""); } catch { errs.push(`ld+json #${i} invalid`); }
      });
      if (document.querySelectorAll('script[type="application/ld+json"]').length === 0) errs.push("no JSON-LD");
      return errs;
    });
    for (const e of ldErrors) failures.push(`${route}: ${e}`);

    // enqueue internal links
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
        .filter((h) => h.startsWith("/") && !h.startsWith("//")),
    );
    for (const l of links) { const clean = l.split("#")[0].split("?")[0]; if (clean && !visited.has(clean)) queue.push(clean); }
  }
  await browser.close();

  // Discovery files
  for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "rss.xml"]) {
    if (!existsSync(path.join(distDir, f))) failures.push(`missing ${f}`);
  }

  server.close();
  const report = [
    `# Template eval — ${new Date().toISOString()}`,
    `Pages crawled: ${visited.size}`,
    failures.length === 0 ? "✅ ALL PASS" : `❌ ${failures.length} failures:`,
    ...failures.map((f) => `- ${f}`),
  ].join("\n");
  const reportPath = path.join(process.cwd(), "scripts/eval", `eval-report-template-${Date.now()}.md`);
  writeFileSync(reportPath, report);
  console.log(report);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Manual Lighthouse: cd ../renderer && pnpm preview, then: npx lighthouse http://localhost:4321 --view (target ≥95 all categories)`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
