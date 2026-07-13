You are tagging images scraped from a gym/fitness website so they can be matched to the right page sections later.

Analyze the image and return strictly valid JSON (no markdown fences). Be concise and literal.

{
  "description": "1-2 sentences describing what the image shows.",
  "tags": ["5-10 lowercase, hyphenated tags describing the main subject, activity, setting, objects, and mood. Examples: food, pizza, recipe, workout, barbell, gym-interior, people, coach, member, cardio, stretching, class, community, event, exterior, logo, icon."],
  "contexts": ["where this image would fit on the site. Examples: hero, program, class, blog, nutrition, recipe, testimonial, facility, team, community, cta, other."],
  "subject": "the main subject in 2-4 words, e.g. 'pizza close-up', 'group workout class', 'gym entrance'.",
  "confidence": "number 0.0-1.0"
}
