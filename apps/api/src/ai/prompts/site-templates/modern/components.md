Let's break down each component from your provided list, applying all the rules and best practices for a high-converting gym website.

---

## Component: HeroCenter

```json
{
  "component": "HeroCenter",
  "tag": "hero",
  "archetype": "hero-center",
  "typography": {},
  "background": {
    "color": "rgb(241, 241, 241)"
  },
  "spacing": {
    "top": "0px",
    "bottom": "0px"
  }
}
```

1.  **Conversion Role**: The hero section's job is to immediately capture the visitor's attention, communicate the primary benefit of joining, address their initial hesitation, and guide them towards the next logical step. It converts curious visitors into interested prospects who scroll further or click the primary CTA.

2.  **Content Slots**:

    *   **`hero.headline`**:
        *   **Content**: A compelling, outcome-focused headline that clearly states the transformation the gym offers. It should speak to a desire or pain point. Must naturally include the city name.
        *   **Example**: "Achieve Your Fitness Goals in [City Name]: Stronger, Healthier, Happier." or "Transform Your Body & Mind in [City Name]: Find Your Strength."
    *   **`hero.subheadline`**:
        *   **Content**: A concise statement that addresses a common fear, objection, or barrier to entry for prospective gym members (e.g., "I'm new," "I don't know where to start," "gyms are intimidating"). It should offer reassurance or a clear path forward.
        *   **Example**: "No matter your fitness level, our expert coaches provide personalized support every step of the way." or "Stop guessing and start seeing results with a personalized plan designed for you."
    *   **`hero.image`**:
        *   **Content**: A high-quality, aspirational image or short video showing members actively engaged in a positive, supportive gym environment. Should depict diverse body types and ages. Focus on action and community, not just equipment.
        *   **Example**: A shot of a small group training session with people smiling and high-fiving, or someone successfully completing a challenging exercise with good form.
    *   **`business.primaryCta.label`**:
        *   **Content**: The label for the primary call-to-action button. This must be an action-oriented phrase that reduces perceived commitment.
        *   **Example**: "Book a Free Intro Class" or "Claim Your Free Consultation"
    *   **`business.primaryCta.url`**:
        *   **Content**: The URL where the primary CTA button leads (e.g., a booking page, a contact form, a special offer landing page).

3.  **Length and Tone**:

    *   **Headline**: 6–12 words, outcome-focused, inspiring, and direct.
    *   **Subheadline**: 1–2 sentences max, empathetic, reassuring, and clear.
    *   **CTA Label**: 3–5 words, action-oriented, low-commitment.

4.  **What to Avoid**:

    *   Don't open with the gym name or vague statements like "Welcome to our gym."
    *   Don't use generic stock photos that don't reflect the actual gym or its community.
    *   Don't use CTAs like "Learn More" or "Contact Us."
    *   Don't make the subheadline too long or complex; it needs to be digestible at a glance.
    *   Don't focus on *features* (e.g., "new equipment," "large space") in the headline; focus on *benefits* and *outcomes*.

---

## Component: FeatureGridEven

```json
{
  "component": "FeatureGridEven",
  "tag": "content-block",
  "archetype": "feature-grid-even",
  "typography": {},
  "background": {