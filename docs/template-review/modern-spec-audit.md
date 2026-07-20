# modern — spec audit

✅ **10/12** detected section types have components (83%)

## Section coverage

| Tag | Archetype | Component | Props | File | Status |
|-----|-----------|-----------|-------|------|--------|
| `contact` | `unknown` | Location | 1/1 | `Location.astro` | ✅ |
| `content-block` | `feature-grid-even` | CoreValues | 1/1 | `CoreValues.astro` | ✅ |
| `cta-band` | `cta-band` | CTABand | 3/3 | `CTABand.astro` | ✅ |
| `faq-block` | `faq-accordion` | FAQ | 2/2 | `FAQ.astro` | ✅ |
| `feature-grid` | `feature-grid-even` | CoreValues | 1/1 | `CoreValues.astro` | ✅ |
| `feature-grid` | `program-cards-sticky` | Programs | 2/2 | `Programs.astro` | ✅ |
| `hero` | `hero-center` | Hero | 1/1 | `Hero.astro` | ✅ |
| `location-block` | `location-split` | Location | 1/1 | `Location.astro` | ✅ |
| `media-block` | `content-media` | Programs | 2/2 | `Programs.astro` | ✅ |
| `schedule` | `unknown` | — | — | — | ❌ no component |
| `team` | `unknown` | — | — | — | ❌ no component |
| `testimonial-band` | `testimonial-scroll` | Testimonials | 2/2 | `Testimonials.astro` | ✅ |
| `unknown` | `unknown` | — | — | — | ⏭  placeholder |

## What to do about uncovered sections

For each ❌ row, run the add-component workflow:
```
pnpm milo template add-component \
  --url <source-url> --name modern \
  --component <tag>/<archetype>
```

This extracts the section HTML+CSS, generates a draft component for review,
then add the mapping to `modernSpec.sectionMapping` and commit.