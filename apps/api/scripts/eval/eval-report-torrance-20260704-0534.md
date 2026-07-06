# Pipeline Eval Report

**Date:** 2026-07-04  
**URLs file:** `/tmp/torrance-url.txt` (1 sites processed)  
**Stages:** extract → segment → docgen → build → verify  
**Pages:** /  
**LLM:** live

---

## 1. Summary

- Successful runs: 1/1
- Failed runs: 0/1
- Master fidelity (pre-heal): min 79, median 79.0, max 79
- Master fidelity (post-heal): min 79, median 79.0, max 79
- Self-heal effectiveness: 0/1 runs improved after re-running suggested stages
- Vision-usage rate: 100.0% of segmented pages (1/1)
- Rung-1 (semantic) section counts: min 1, median 1.0, max 1
- Total sections / URL: min 15, median 15.0, max 15

## 2. Per-URL results

| # | URL | Duration | Sections | Rung1 | Vision | Fidelity (pre) | Fidelity (post) | Failed stage | Deploy |
|---|---|---|---|---|---|---|---|---|---|
| 1 | https://www.torrancetraininglab.com/ | 129.7s | 15 | 1 | yes | 79 | 79 |  | — |

## 3. Per-stage failures

| Stage | Failures |
|---|---|
| extract | 0 |
| segment | 0 |
| docgen | 0 |
| build | 0 |
| verify | 0 |

## 4. Fidelity distribution

### Pre-heal

| Range | Count |
|---|---|
| 0–19 | 0 |
| 20–39 | 0 |
| 40–59 | 0 |
| 60–69 | 0 |
| 70–79 | 1 |
| 80–89 | 0 |
| 90–99 | 0 |
| 100+ | 0 |

### Post-heal

| Range | Count |
|---|---|
| 0–19 | 0 |
| 20–39 | 0 |
| 40–59 | 0 |
| 60–69 | 0 |
| 70–79 | 1 |
| 80–89 | 0 |
| 90–99 | 0 |
| 100+ | 0 |

## 6. Build logs

### https://www.torrancetraininglab.com/

- Pages built: index
- Shared components: none
- Fallbacks (LLM retry exhausted): none

| Category | Description | Page |
|---|---|---|
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61897dfcb552d4ec684be279_Homepage%20-%20Torrance%2 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61897dfe6e83d80702ca4a87_Homepage%20-%20Torrance%2 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6185ad6ce43a402f0cfcb813_Torrance%20Training%20Lab | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6189862086bf4792e256237d_New%20To%20CrossFit%20at% | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6185ab01eac48a57d79bb71d_Torrance%20Training%20Lab | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61898256fcb4b822975a082a_CrossFit%20Classes%20at%2 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61846b3b19bf27682eeb5398_Bootcamp%20Classes%20(1). | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618c0f4546585510726c616c_HIIT%20Classes%20at%20Tor | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf2709ebeb507c_Icon.svg as https://pushp | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf270fc2eb508f_2.svg as https://pushpres | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf271768eb508a_3.svg as https://pushpres | index |
| performance | Re-hosted https://sidebar.bugherd.com/assets/bh_logo_short-1d6af89eca7e694074a6e0bd9201111a89f1683346b813c99cd5b395cf7d7 | index |
| performance | Re-hosted https://files.bugherd.com/lxf6qbxjgnceyaaztznuvq/256x256.jpg as https://pushpress-marketing-dev.s3.us-east-1.a | index |
| performance | Re-hosted https://storage.googleapis.com/revex-reputation-production/assets/google-icon.svg as https://pushpress-marketi | index |
| performance | Re-hosted https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/locationPhotos%2F1uZTf3N5tL5JS8cNO | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618986ab61b593898dce7c6b_Torrance%20Training%20Lab | index |
| performance | Re-hosted https://maps.googleapis.com/maps/api/js/StaticMapService.GetMapImage?1m2&1i718117&2i1677905&2e1&3u14&4m2&1u611 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf273c81eb509b_Vector.svg as https://pus | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf273585eb5092_yt.svg as https://pushpre | index |
| performance | Re-hosted https://maps.gstatic.com/mapfiles/openhand_8_8.cur as https://pushpress-marketing-dev.s3.us-east-1.amazonaws.c | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2806!3i6555!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2805!3i6554!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2806!3i6554!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2805!3i6555!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2807!3i6554!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2807!3i6555!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i11!2i350!3i819!4i256!2m1!1e1!3m12!2sen!3sUS!5e289!12m3!1e37!2m1!1 | index |

