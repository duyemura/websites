import type { APIRoute } from "astro";
import { content, absUrl } from "../lib/content";

export const GET: APIRoute = () => {
  const { business, meta, pages } = content;
  const hours = business.hours.map((h) => `- ${h.days.join(", ")}: ${h.opens}–${h.closes}`).join("\n");
  const faq = pages.home.faq.map((f) => `**Q: ${f.question}**\nA: ${f.answer}`).join("\n\n");

  const programDetails = pages.programs.map((p) => {
    const lines = [`### ${p.name}`, `URL: ${absUrl(`/programs/${p.slug}`)}`];
    if (p.shortDescription) lines.push(p.shortDescription);
    if (p.whatIsIt?.body) lines.push(`\n${p.whatIsIt.body}`);
    if (p.whoIsItFor?.length) lines.push(`\nWho it's for: ${p.whoIsItFor.join(", ")}`);
    if (p.whatMakesUsDifferent?.length) lines.push(`\nWhat makes it different: ${p.whatMakesUsDifferent.slice(0, 3).join("; ")}`);
    if (p.faq?.length) {
      lines.push(`\nFrequently asked questions:`);
      p.faq.slice(0, 3).forEach((f) => lines.push(`- Q: ${f.question}\n  A: ${f.answer}`));
    }
    return lines.join("\n");
  }).join("\n\n");

  const programsSection = pages.programs.length
    ? `## Programs\n\n${business.name} offers the following programs:\n\n${programDetails}`
    : "";

  const pricingSection = pages.pricing?.grid?.plans?.length
    ? `## Membership pricing\n\n${pages.pricing.grid.plans.map((plan) =>
        `- **${plan.name}**: ${plan.price}${plan.period ? ` ${plan.period}` : ""}${plan.description ? ` — ${plan.description}` : ""}`
      ).join("\n")}`
    : "";

  const howItWorksSection = `## How to get started\n\n${pages.home.howItWorks?.map((s) => `${s.number}. **${s.headline}** — ${s.body}`).join("\n") || `Contact us at ${business.phone} to get started.`}`;

  const testimonialsSection = pages.home.testimonials?.length
    ? `## Member testimonials\n\n${pages.home.testimonials.slice(0, 5).map((t) =>
        `"${t.quote}" — ${t.name}${t.program ? ` (${t.program})` : ""}`
      ).join("\n\n")}`
    : "";

  const optionalSections = [programsSection, pricingSection, howItWorksSection, testimonialsSection]
    .filter(Boolean)
    .join("\n\n");

  const body = `# ${business.name}

> ${business.tagline}

${business.name} is a gym located at ${business.address.street}, ${business.address.city}, ${business.geo.state} ${business.address.zip}.

## Contact information

- Phone: ${business.phone}${business.email ? `\n- Email: ${business.email}` : ""}
- Website: ${meta.siteUrl}
- Address: ${business.address.street}, ${business.address.city}, ${business.geo.stateAbbr} ${business.address.zip}
- Service area: ${[business.geo.city, ...(business.serviceArea ?? [])].join(", ")}

## Hours

${hours}

${optionalSections}

## Frequently asked questions

${faq || "See our website for FAQs."}
`.trim();

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
