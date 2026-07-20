# modern — component eval report

Overall: 0/5 components passed (score ≥ 85)

## ❌ Unknown — score: 78 (3 iterations)
- **font-size**: expected larger for headline and subheading, got smaller [major]
- **line-height**: expected tighter for headline and subheading, got looser [minor]
- **button background-color**: expected brighter red/orange, got darker red/maroon [major]
- **button padding**: expected more horizontal padding, got less horizontal padding [minor]
- **card background-color**: expected white, got light gray [minor]
- **card border-radius**: expected slightly more rounded, got less rounded [minor]
- **spacing between cards**: expected larger gap, got smaller gap [minor]
- **text color inside cards**: expected darker gray/black, got lighter gray [minor]

## ❌ FeatureGridEven — score: 78 (3 iterations)
- **font-size**: expected larger for headline, got smaller for headline [minor]
- **font-weight**: expected bolder for headline, got less bold for headline [minor]
- **button background-color**: expected #7C3AED, got #4F46E5 [minor]
- **button border-radius**: expected more rounded, got less rounded [minor]
- **card background-color**: expected white, got light gray/off-white [minor]
- **card box-shadow**: expected more pronounced, got less pronounced or absent [minor]
- **spacing**: expected different vertical spacing between headline and cards, got different [minor]
- **card content alignment**: expected left-aligned text inside cards, got centered text inside cards [minor]

## ❌ HeroCenter — score: 78 (3 iterations)
- **font-weight**: expected 700 (for 'Placeholder headline'), got 400 [minor]
- **font-size**: expected larger for headline, got smaller [minor]
- **line-height**: expected tighter for headline, got looser [minor]
- **button background-color**: expected dark purple/black, got blue [minor]
- **button color**: expected white, got white [minor]
- **button border-radius**: expected more rounded, got less rounded [minor]
- **layout/spacing**: expected more vertical space between headline and cards, got less vertical space [minor]
- **card padding**: expected more internal padding for card content, got less internal padding [minor]

## ❌ FeatureGridEvenFeatureGrid — score: 78 (3 iterations)
- **font-size**: expected larger for section title, got smaller for section title [minor]
- **font-weight**: expected bolder for section title, got less bold for section title [minor]
- **spacing**: expected more vertical space between section title and cards, got less vertical space between section title and cards [minor]
- **background-color**: expected light gray/off-white, got white [minor]
- **border-radius**: expected more rounded corners for cards, got less rounded corners for cards [minor]
- **box-shadow**: expected more prominent box-shadow for cards, got subtler box-shadow for cards [minor]
- **padding**: expected more padding around the content within the cards, got less padding around the content within the cards [minor]

## ❌ ProgramCardsSticky — score: 78 (3 iterations)
- **font-size**: expected larger for headline, got smaller [minor]
- **letter-spacing**: expected tighter for headline, got wider [minor]
- **button background-color**: expected #ff6600 (orange), got #007bff (blue) [major]
- **button border-radius**: expected more rounded, got less rounded [minor]
- **button padding**: expected more vertical padding, got less vertical padding [minor]
- **card border-radius**: expected more rounded, got less rounded [minor]
- **card box-shadow**: expected more prominent, got less prominent/absent [minor]
- **spacing between cards and description**: expected larger gap, got smaller gap [minor]

## Next steps
For each ❌ component, fix the .astro file then run:
```
milo template-eval --name modern --component <ComponentName>
```