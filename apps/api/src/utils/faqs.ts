export interface ScrapedFaq {
  question: string;
  answer: string;
}

export function dedupeFaqs(faqs: ScrapedFaq[]): ScrapedFaq[] {
  const seen = new Set<string>();
  const result: ScrapedFaq[] = [];
  for (const faq of faqs) {
    const normalized = faq.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(faq);
  }
  return result;
}
