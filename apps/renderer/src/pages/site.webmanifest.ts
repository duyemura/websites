import type { APIRoute } from "astro";
import { content } from "../lib/content";

export const GET: APIRoute = () => {
  const { business, brand } = content;
  return new Response(JSON.stringify({
    name: business.name,
    short_name: business.name,
    icons: [{ src: brand.logoUrl, sizes: "any" }],
    theme_color: brand.primaryColor,
    background_color: "#ffffff",
    display: "browser",
  }), { headers: { "Content-Type": "application/manifest+json" } });
};
