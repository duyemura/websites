import type { APIRoute } from "astro";
import { content, absUrl } from "../lib/content";

export const GET: APIRoute = () => {
  const { business, meta, pages } = content;
  const hours = business.hours.map((h) => `- ${h.days.join(", ")}: ${h.opens}–${h.closes}`).join("\n");
  const programs = pages.programs.map((p) => `- [${p.name}](${absUrl(`/programs/${p.slug}`)}): ${p.shortDescription}`).join("\n");
  const faq = pages.home.faq.map((f) => `**Q: ${f.question}**\nA: ${f.answer}`).join("\n\n");
  const body = `# ${business.name}

> ${business.tagline}

- Location: ${business.address.street}, ${business.address.city}, ${business.geo.stateAbbr} ${business.address.zip}
- Phone: ${business.phone}
- Service area: ${[business.geo.city, ...(business.serviceArea ?? [])].join(", ")}
- Website: ${meta.siteUrl}

## Hours
${hours}

## Programs
${programs}

## Frequently asked questions
${faq}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
