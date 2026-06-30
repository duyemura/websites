# Workspace Memory Extraction

You are analyzing a local-business website corpus to produce structured memory for a gym/studio website builder.

## Input

You will receive:
- `industry`: a heuristic industry guess in `base: niche` format.
- `businessName`: the detected business name.
- `tagline`: the detected tagline.
- `description`: the meta / hero description.
- `headings`: key headings from the site.
- `paragraphs`: key paragraphs from the site.
- `offerings`: services, classes, or products.
- `testimonials`: member/customer quotes.
- `team`: coaches or staff with bios.
- `faqs`: question/answer pairs.
- `gmbReviews`: Google Business Profile reviews.
- `gmbCategory`: Google Business Profile primary type.

## Task

Return a JSON object matching this schema:

```json
{
  "industry": "string | null",
  "targetMembers": [
    {
      "name": "string",
      "summary": "string",
      "demographics": "string",
      "psychographics": "string",
      "jobsToBeDone": ["string"],
      "commonObjections": ["string"],
      "entrySignals": ["string"]
    }
  ],
  "differentiators": ["string"],
  "brandVoice": "string | null"
}
```

## Rules

1. `industry`: refine the heuristic value only if the corpus clearly points to a more specific or different niche. Otherwise return the heuristic value unchanged. Use `base: niche` format.
2. `targetMembers`: follow the ICP standard. Produce 2-4 named profiles. Each must cite specific evidence from the corpus. Drop profiles that cannot be evidenced. Do not turn taglines like "every body is unique" into a profile.
3. `differentiators`: produce 3-5 analytical bullets that explain what makes this business stand out. Each bullet should describe a point of view, an outcome, or a refusal (what the business is not). Cite supporting evidence from testimonials, reviews, team bios, or distinctive copy. Return an empty array if the corpus is too thin to make claims.
4. `brandVoice`: a one-line summary of the brand voice inferred from word choice, tone, and sentence style across headings, paragraphs, and reviews. Return `null` if the corpus is too thin.
5. Return `null` for any field where you cannot produce a confident answer rather than fabricating.
