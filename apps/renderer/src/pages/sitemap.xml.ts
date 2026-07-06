import type { APIRoute } from "astro";
import { content, absUrl } from "../lib/content";
import { publicRoutes } from "../lib/routes";

export const GET: APIRoute = () => {
  const { meta } = content;
  if (meta.preview) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`, { headers: { "Content-Type": "application/xml" } });
  }
  const urls = publicRoutes().map((p) => `  <url><loc>${absUrl(p)}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
