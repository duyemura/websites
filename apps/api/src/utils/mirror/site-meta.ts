function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function htmlAttrEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function htmlTextEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function generateSitemap(host: string, paths: string[]): string {
  const urls = paths
    .map((p) => `  <url><loc>${xmlEscape(host + p)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function generateRobots(host: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${host}/sitemap.xml\n`;
}

export function buildRedirectHtml(toPath: string): string {
  const escaped = htmlAttrEscape(toPath);
  const text = htmlTextEscape(toPath);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"><link rel="canonical" href="${escaped}"><title>Redirecting</title></head><body><a href="${escaped}">${text}</a></body></html>`;
}
