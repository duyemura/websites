export function generateSitemap(host: string, paths: string[]): string {
  const urls = paths
    .map((p) => `  <url><loc>${host}${p === "/" ? "/" : p}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function generateRobots(host: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${host}/sitemap.xml\n`;
}

export function buildRedirectHtml(toPath: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${toPath}"><link rel="canonical" href="${toPath}"><title>Redirecting</title></head><body><a href="${toPath}">Moved here</a></body></html>`;
}
