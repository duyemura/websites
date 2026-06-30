# Business Info Extraction

You are summarizing a local-business website corpus into a single, dense reference doc for a gym/studio website builder. This doc will be read by marketing assistants and site-generation agents, so every field must be concise and factual. Avoid marketing fluff, duplicate data, and generic superlatives.

## Input

You will receive:
- `businessName`: detected business name.
- `tagline`: detected tagline / GMB editorial summary.
- `description`: meta / hero description.
- `headings`: key headings from the site.
- `paragraphs`: key paragraphs from the site.
- `offerings`: services, classes, or products.
- `locations`: physical locations with addresses and hours.
- `contact`: phone, email, and social links.
- `team`: coaches or staff with bios.
- `testimonials`: member/customer quotes.
- `faqs`: question/answer pairs.
- `gmb`: Google Business Profile fields (rating, review count, primary category, address, phone, hours, reviews, website, maps URL).

## Task

Return **only** a raw JSON object matching this schema. Do not wrap the JSON in Markdown fences or add explanations.

```json
{
  "businessName": "string",
  "tagline": "string | null",
  "oneLineSummary": "string",
  "classification": {
    "industryNiche": "string",
    "serviceModel": "string",
    "primaryAudience": "string"
  },
  "location": {
    "address": "string",
    "hours": [
      { "day": "Monday", "hours": "05:00–20:00" }
    ]
  } | null,
  "contact": {
    "phone": "string | null",
    "email": "string | null",
    "website": "string | null",
    "googleMapsUrl": "string | null",
    "socials": [{ "platform": "string", "url": "string" }]
  },
  "offerings": [
    {
      "name": "string",
      "description": "string",
      "intendedFor": "string | null",
      "priceFrequency": "string | null"
    }
  ],
  "trustSignals": {
    "gmbRating": "number | null",
    "reviewCount": "number | null",
    "teamCredentials": ["string"]
  } | null,
  "testimonials": [
    {
      "quote": "string",
      "author": "string | null",
      "theme": "community | coaching | results | beginner | atmosphere | other"
    }
  ],
  "faqs": [
    { "question": "string", "answer": "string" }
  ],
  "conversionSignals": {
    "primaryCta": "string",
    "offer": "string | null",
    "signupMethod": "string | null"
  },
  "messagingThemes": ["string"],
  "competitiveAngle": "string"
}
```

## Rules

1. `businessName`: use the GMB name if available; otherwise the scraped business name or site title. Clean up suffixes like "LLC" or "Inc" only if they clutter the brand name.
2. `tagline`: return a refined one-line tagline only if the source is substantive. Reject generic slogans like "Best Gym in Torrance" or "Every body is unique." Return `null` if nothing strong exists.
3. `oneLineSummary`: a single sentence that states what the business is, who it serves, and the key outcome. Example: "CrossFit gym in Torrance offering coached group classes and personal training for athletes at every level."
4. `classification`:
   - `industryNiche`: concise niche, e.g. `fitness / gym: CrossFit` or `fitness studio: Yoga`.
   - `serviceModel`: how clients consume the service, e.g. `group classes + personal training`, `semi-private training`, `class membership`, `drop-ins + memberships`.
   - `primaryAudience`: 5–10 words describing the main member profile, e.g. `busy South Bay professionals and families`.
5. `location`: dedupe to a single primary location. Use the GMB address as the source of truth. Format hours as `HH:MM–HH:MM`; use `Closed` when closed. Return `null` if no address.
6. `contact`: prefer GMB phone/website when both exist. Include only verified social URLs.
7. `offerings`: filter out slogans and mission statements. Each item must be an actual service/class. Provide a 1-sentence description and, if known, price or frequency. Set `intendedFor` to the audience for that offering when clear (e.g. `beginners`, `seniors`, `competitors`).
8. `trustSignals`: capture GMB rating/review count if present, plus 1–3 concrete team credentials (certifications, degrees, years of experience, competition achievements). Keep credentials short.
9. `testimonials`: curate up to 5 high-quality quotes. Group by `theme`. Trim rambling quotes to the most impactful 1–2 sentences while preserving meaning. Include attribution when available.
10. `faqs`: dedupe and rewrite up to 8 FAQs as concise Q&A. Remove duplicate questions and merge similar answers.
11. `conversionSignals`:
    - `primaryCta`: the main action the site pushes, e.g. `Book a free trial`, `Schedule a class`, `Call to join`.
    - `offer`: the specific hook if present, e.g. `First class free`, `No-sweat intro`.
    - `signupMethod`: how the visitor converts, e.g. `Contact form`, `Phone call`, `PushPress booking link`.
12. `messagingThemes`: 3–5 concise copy pillars that should appear across the site. Each is one short sentence or phrase. Example: `Coached sessions every visit`, `Scalable for any fitness level`, `South Bay location with flexible hours`.
13. `competitiveAngle`: one sentence stating what makes this business the better choice versus generic or big-box alternatives. Use evidence from reviews, team, offerings, or copy.
14. Return empty arrays or `null` rather than fabricating data. Never duplicate the same fact in multiple fields.
15. Keep the total output tight: every field is loaded into future LLM prompts, so brevity matters.
