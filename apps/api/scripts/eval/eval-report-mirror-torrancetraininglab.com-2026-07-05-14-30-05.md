# Mirror Eval — torrancetraininglab.com

**Date:** 2026-07-05 14:33  
**Source:** https://torrancetraininglab.com  
**Mirror base:** https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/sites/ab867633-9d48-4258-b752-07214d6314b7/deploys/3-1783261880258/index.html  
**Site UUID:** `ab867633-9d48-4258-b752-07214d6314b7`  
**Duration:** 179.6s  
**Result:** ❌ 3 FAIL

---

## Per-page scores

| Path | Similarity | Height Δ (px) | Broken assets | Forms (crawl) | Warnings | Result |
|------|-----------|--------------|---------------|--------------|----------|--------|
| / | 70% | +4778 | 22 | 0 | plugin:Webflow | ❌ FAIL |
| /programs/get-started | 60% | +2090 | 24 | 0 | plugin:Webflow, booking-widget:booking widget from api.grow. | ❌ FAIL |
| /programs/drop-in | 58% | +1179 | 24 | 0 | plugin:Webflow, booking-widget:booking widget from api.grow. | ❌ FAIL |

> Height Δ = origin height minus mirror height in pixels. Negative means mirror is taller.

## Failures (similarity < 95 or broken assets > 0)

### /
- Similarity: 70% (height Δ: 4778px)
- Broken assets (22):
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/c5e942603c54.css
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/2d1429f5ff67.jpg
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/776a39a5cf9f.bin
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/9f87595f8945.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/aa9d13ade308.jpg
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/32ed8cb76fc5.css
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/abc76d03018e.bin
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/44cd00dc0dac.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/a8a82654ebb2.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/25a397c026b0.js

### /programs/get-started
- Similarity: 60% (height Δ: 2090px)
- Broken assets (24):
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/c5e942603c54.css
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/776a39a5cf9f.bin
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/44cd00dc0dac.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/9f87595f8945.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/abc76d03018e.bin
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/46996ff3d51d.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/32ed8cb76fc5.css
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/ff74fd0ada2c.png
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/25a397c026b0.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/568be0f1eda5.js

### /programs/drop-in
- Similarity: 58% (height Δ: 1179px)
- Broken assets (24):
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/c5e942603c54.css
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/44cd00dc0dac.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/776a39a5cf9f.bin
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/32ed8cb76fc5.css
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/46996ff3d51d.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/9f87595f8945.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/abc76d03018e.bin
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/ff74fd0ada2c.png
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/25a397c026b0.js
  - 403 https://pushpress-marketing-dev.s3.us-east-1.amazonaws.com/_assets/ee817ae09904.js

## Thresholds

- Similarity ≥ 95 = PASS (below 95 is a rewriter/crawler bug, not tuning)
- Zero broken same-origin assets = PASS
- Large height Δ with high similarity = missing section not caught by pixel diff — investigate manually

