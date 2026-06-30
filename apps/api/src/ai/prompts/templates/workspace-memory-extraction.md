# Workspace Memory Extraction

You are analyzing a local-business website corpus to produce structured marketing memory for a gym/studio website builder. The goal is to answer two questions: who is this business for, who should it avoid, and why should the right person choose it?

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
  "positioning": "string | null",
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
  "antiTargetMembers": [
    {
      "name": "string",
      "summary": "string"
    }
  ],
  "differentiators": ["string"],
  "brandVoice": "string | null"
}
```

## Rules

1. `positioning`: one-line business positioning that names the audience and the unique outcome or alternative the business offers. Example: "Semi-private personal training for busy South Bay professionals who want accountability without a big-box gym." Reject generic descriptions like "your premier personal training facility" or copy that merely restates the category. Return `null` if you cannot write a substantive positioning line.
2. `industry`: refine the heuristic value only if the corpus clearly points to a more specific or different niche. Otherwise return the heuristic value unchanged. Use `base: niche` format.
3. `targetMembers`: follow the ICP standard. Produce 2-4 named profiles. Each profile must be someone a marketing campaign could target, with direct evidence from the corpus. Keep every field to 1-2 short sentences. Do not turn taglines like "every body is unique" into a profile. Do not list offerings as profiles.
4. `antiTargetMembers`: 1-2 profiles the business should actively avoid. Keep each to a short name and a one-sentence summary.
5. `differentiators`: produce 3-5 analytical bullets that explain what makes this business stand out. Each bullet should describe a point of view, an outcome, or a refusal (what the business is not). Cite supporting evidence from testimonials, reviews, team bios, or distinctive copy. Return an empty array if the corpus is too thin to make claims.
6. `brandVoice`: a one-line summary of the brand voice inferred from word choice, tone, and sentence style across headings, paragraphs, and reviews. Return `null` if the corpus is too thin.
7. Return `null` for any field where you cannot produce a confident answer rather than fabricating.
