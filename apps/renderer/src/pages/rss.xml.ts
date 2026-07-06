import type { APIRoute } from "astro";
import { content, absUrl } from "../lib/content";

export const GET: APIRoute = () => {
  const { meta, business, pages } = content;
  const feedUrl = absUrl("/rss.xml");
  const items = [...pages.blog.posts]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((p) => [
      `<item>`,
      `<title><![CDATA[${p.title}]]></title>`,
      `<link>${absUrl(`/blog/${p.slug}`)}</link>`,
      `<guid>${absUrl(`/blog/${p.slug}`)}</guid>`,
      `<pubDate>${new Date(p.publishedAt + "T00:00:00Z").toUTCString()}</pubDate>`,
      `<description><![CDATA[${p.excerpt}]]></description>`,
      `</item>`,
    ].join(""))
    .join("");

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `<channel>`,
    `<title><![CDATA[${business.name} Blog]]></title>`,
    `<link>${meta.siteUrl}/blog</link>`,
    `<description><![CDATA[${meta.defaultDescription}]]></description>`,
    `<language>en-us</language>`,
    `<atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />`,
    `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    items,
    `</channel>`,
    `</rss>`,
  ].join("");

  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
