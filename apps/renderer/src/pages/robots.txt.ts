import type { APIRoute } from "astro";
import { content, absUrl } from "../lib/content";

export const GET: APIRoute = () => {
  const { meta } = content;
  const body = meta.preview
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${absUrl("/sitemap.xml")}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
};
