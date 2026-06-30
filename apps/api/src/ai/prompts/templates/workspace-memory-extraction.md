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

Return **only** a raw JSON object matching this schema. Do not wrap the JSON in Markdown fences or add explanations.

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

## Example

For a CrossFit gym whose corpus mentions small group classes, beginner-friendly onboarding, and Games-level coaches, a good response looks like:

```json
{
  "industry": "fitness / gym: CrossFit",
  "positioning": "Community-driven CrossFit for busy South Bay professionals who want coached, scalable workouts without the intimidating big-gym atmosphere.",
  "targetMembers": [
    {
      "name": "Busy parent needing efficiency",
      "summary": "Working parent fitting fitness into a tight schedule and prioritizing community accountability.",
      "demographics": "Ages 30-45, lives or works within 15 minutes, early morning or lunch class preference.",
      "psychographics": "Wants scalable workouts, personal attention, and a welcoming culture rather than competition.",
      "jobsToBeDone": ["Stay active without spending hours at the gym", "Find a supportive fitness community"],
      "commonObjections": ["I do not have time for long classes"],
      "entrySignals": ["asks about class times", "mentions busy schedule"]
    },
    {
      "name": "Former athlete seeking structure",
      "summary": "Ex-team athlete who misses coached training and wants structured programming to get back in shape.",
      "demographics": "Ages 25-40, previous competitive or team sport background.",
      "psychographics": "Misses locker-room camaraderie and craves measurable progress and coaching feedback.",
      "jobsToBeDone": ["Regain athletic conditioning", "Train with like-minded people"],
      "commonObjections": ["Worries CrossFit is too intense"],
      "entrySignals": ["mentions past sport experience", "asks about scaling"]
    }
  ],
  "antiTargetMembers": [
    {
      "name": "Discount hopper",
      "summary": "Negotiates on price, ignores onboarding, and churns quickly; drains staff and disrupts community."
    }
  ],
  "differentiators": [
    "Elite coaching credibility from a CrossFit Games athlete owner.",
    "Small group classes designed for personal attention and friendships."
  ],
  "brandVoice": "Warm, inclusive, and elite-credible."
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
