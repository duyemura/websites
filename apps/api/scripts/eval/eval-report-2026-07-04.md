# Pipeline Eval Report

**Date:** 2026-07-04  
**URLs file:** `../../eval-gym-urls.txt` (1 sites processed)  
**Stages:** extract → segment → docgen → build  
**Pages:** all captured  
**LLM:** mocked (in-process HTTP stub)

---

## 1. Summary

- Successful runs: 1/1
- Failed runs: 0/1
- Self-heal effectiveness: 0/0 runs improved after re-running suggested stages
- Vision-usage rate: 100.0% of segmented pages (50/50)
- Rung-1 (semantic) section counts: min 0, median 1.0, max 4
- Total sections / URL: min 100, median 100.0, max 100

## 2. Per-URL results

| # | URL | Duration | Sections | Rung1 | Vision | Fidelity (pre) | Fidelity (post) | Failed stage | Deploy |
|---|---|---|---|---|---|---|---|---|---|
| 1 | https://www.torrancetraininglab.com/ | 1157.9s | 100 | 51 | yes | — | — |  | — |

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
| 70–79 | 0 |
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
| 70–79 | 0 |
| 80–89 | 0 |
| 90–99 | 0 |
| 100+ | 0 |

## 6. Build logs

### https://www.torrancetraininglab.com/

- Pages built: index, programs-get-started, programs-drop-in, programs-crosstrain-classes, programs-bootcamp, programs-sweat-classes, schedule, membership-pricing, about, blog, contact, coach-bio-request, events-event-template, hsn-recipes, member-highlights, membership-cancellation, membership-hold, nutrition, pricing, recipes, search, testimonial-slider, torrance-local-guide, links, blog-4-best-public-parks-plus-1-beach-to-workout-in-torrance-ca, coaches-scot-webb, recipes-avocado-and-egg-breakfast-sandwich, recipes-baked-avocado-eggs, recipes-baked-eggs-with-spinach-and-feta, recipes-baked-salmon-with-honey-mustard-glaze, recipes-broiled-pork-chops-with-roasted-vegetables, recipes-cauliflower-crust-pizza-with-pesto-and-roasted-vegetables, recipes-cauliflower-rice-stir-fry-with-shrimp-and-vegetables, recipes-chicken-caesar-salad-with-greek-yogurt-dressing, recipes-eggplant-and-tomato-skillet, recipes-energy-balls-with-dates-and-almonds, recipes-frozen-yogurt-bark, recipes-garlic-roasted-brussel-sprouts, recipes-garlic-roasted-potatoes, recipes-greek-chicken-salad, recipes-greek-yogurt-and-fruit-parfait, recipes-green-smoothie-bowl-with-berries-and-chia-seeds, recipes-grilled-chicken-with-avocado-and-tomato-salsa, recipes-grilled-lemon-pepper-salmon, recipes-grilled-salmon-with-avocado-salsa, recipes-grilled-shrimp-skewers-with-garlic-and-herbs, recipes-grilled-steak-with-chimichurri-sauce, recipes-homemade-hummus-with-veggies, recipes-keto-chicken-alfredo-zucchini-noodles, recipes-lemon-herb-grilled-chicken
- Shared components: shared-0, shared-1
- Fallbacks (LLM retry exhausted): none

| Category | Description | Page |
|---|---|---|
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61897dfcb552d4ec684be279_Homepage%20-%20Torrance%2 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61897dfe6e83d80702ca4a87_Homepage%20-%20Torrance%2 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6185ad6ce43a402f0cfcb813_Torrance%20Training%20Lab | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf2709ebeb507c_Icon.svg as https://pushp | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf270fc2eb508f_2.svg as https://pushpres | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf271768eb508a_3.svg as https://pushpres | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6189862086bf4792e256237d_New%20To%20CrossFit%20at% | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6185ab01eac48a57d79bb71d_Torrance%20Training%20Lab | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61898256fcb4b822975a082a_CrossFit%20Classes%20at%2 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61846b3b19bf27682eeb5398_Bootcamp%20Classes%20(1). | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618c0f4546585510726c616c_HIIT%20Classes%20at%20Tor | index |
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
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2805!3i6555!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2807!3i6555!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2805!3i6554!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2807!3i6554!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i14!2i2806!3i6554!4i256!2m3!1e0!2sm!3i785550568!2m3!1e2!2sspotlit! | index |
| performance | Re-hosted https://www.google.com/maps/vt?pb=!1m5!1m4!1i11!2i350!3i819!4i256!2m1!1e1!3m12!2sen!3sUS!5e289!12m3!1e37!2m1!1 | index |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6189871000de62300065453c_Get%20Started%20at%20Torr | programs-get-started |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6189871183cb65a52b4db697_Get%20Started%20at%20Torr | programs-get-started |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618983d50bf9301a326442fb_Drop%20In%20Classes%20at% | programs-drop-in |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618983836e83d80aa9ca7158_Drop%20In%20Classes%20at% | programs-drop-in |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618989181606f101dff5a7b1_CrossFit%20Classes%20at%2 | programs-crosstrain-classes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6189822952a44df014ff6dce_CrossFit%20Classes%20at%2 | programs-crosstrain-classes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618985a26a1f3449eb6017fb_Bootcamp%20Classes%20at%2 | programs-bootcamp |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61846b3b19bf2718b3eb5399_Bootcamp%20Classes%20(2). | programs-bootcamp |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618984c57924d5f0c764e8ac_HIIT%20Classes%20at%20Tor | programs-sweat-classes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/618980d30969282120c14ad1_Schedule%20of%20Classes%2 | schedule |
| performance | Re-hosted https://heapanalytics.com/h?a=352269000&u=8340303237011266&v=1666233288931105&s=5839986596567654&b=web&tv=4.0& | schedule |
| performance | Re-hosted https://heapanalytics.com/h?a=352269000&u=8340303237011266&v=7226140263915685&s=5839986596567654&b=web&tv=4.0& | schedule |
| performance | Re-hosted https://heapanalytics.com/h?a=352269000&u=8340303237011266&v=8095640466128248&s=5839986596567654&b=web&tv=4.0& | schedule |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf270bd8eb50e8_Schedule%2520of%2520Class | schedule |
| performance | Re-hosted https://stcdn.leadconnectorhq.com/intl-tel-input/17.0.12/img/flags.png as https://pushpress-marketing-dev.s3.u | membership-pricing |
| performance | Re-hosted https://www.gstatic.com/recaptcha/api2/logo_48.png as https://pushpress-marketing-dev.s3.us-east-1.amazonaws.c | membership-pricing |
| performance | Re-hosted https://msgsndr-private.storage.googleapis.com/companyPhotos/b9925981-6115-4b52-bbed-542c07b3503c.png as https | membership-pricing |
| performance | Re-hosted https://cdn.prod.website-files.com/5efc770d7039bd137deb607b/5f08e52b2ae54424f99f9b4d_Rectangle%2065.png as htt | about |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61897e798b3d2646c7fb321f_About%20Us%20-%20Torrance | about |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61898785403b293d4213c3b2_About%20Torrance%20Traini | about |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61897e7be053305b1c18c542_About%20Us%20-%20Torrance | about |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61846b3b19bf276268eb52a3_blog.jpeg as https://push | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/643ea0c5be8fd87232a7965e_alora-griffiths-LOnMc8Rp1 | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/643e9f67f4b2224d705e49c0_humphrey-muleba-LOA2mTj1v | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/643e9a663bfc9c38bd2d7c98_luis-vidal-UNbiqyCAFrg-un | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/643ea1a13f992f4b603ffc36_pexels-kampus-production- | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/643e9da57105292e21e4aa73_daniel-apodaca-WdoQio6HPV | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/643e994fa10a2fbb9421c4a2_graham-mansfield-3Y088bwf | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/61846b3b19bf275d18eb5381_pricing%20mobile.jpeg as  | blog |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/618982ffb81f1b2c494be48e_Contact%20Us%20-%20Torran | contact |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/6189830110ab3832f30b2c12_Contact%20Us%20-%20Torran | contact |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27e53aeb50f0_unsplash_eot-ka5dM7Q-min. | events-event-template |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27da93eb50eb_unsplash_RrCvrrYtlqQ-min. | events-event-template |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf2714cfeb50ec_location.svg as https://p | events-event-template |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27628eeb50ed_cost.svg as https://pushp | events-event-template |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf2729d7eb50ef_time-and-date-1.svg as ht | events-event-template |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27321feb50ee_time.svg as https://pushp | events-event-template |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27840deb50e4_Breakfast%20HSN.jpg as ht | hsn-recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27d847eb50dd_pexels-bulbfish-1143754.j | hsn-recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf2753c1eb50da_pexels-pixabay-361184.jpg | hsn-recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf278f26eb50d8_lunch%2520hsn-p-500.jpeg  | hsn-recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf274ca0eb50d5_Healthy%20Snacks%20Recipe | hsn-recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf270b20eb50d7_Healthy%20Treats%20HSN.jp | hsn-recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27b290eb50d2_Healthy%20side%20recipes. | hsn-recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27f581eb50e5_Healthy%2520Recipes%2520( | hsn-recipes |
| performance | Re-hosted https://images.leadconnectorhq.com/image/f_webp/q_80/r_200/u_https://firebasestorage.googleapis.com/v0/b/highl | membership-cancellation |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf274a4aeb50c5_Ellipse%2075.svg as https | nutrition |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf273480eb50c1_corner-up-right.svg as ht | nutrition |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf27a275eb50ea_Nutrition%20and%20Fitness | nutrition |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/64221f2c2bea3c623cf497d0_bertrand-borie-47mkgWDly0 | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/64221cac5b697fce6b10fc03_chris-tweten-FK-UKNip0pE- | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641bae25c2f5a93f75c2fc9c_daniel-hooper-PaaboPF3dVY | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a574e614c8733e2cf3e67_sonny-mauricio-smbmkO3mwf | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a19f5c7f9f275736024c9_salmon-p-500.webp as http | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a168fb3542ba156edcd79_mikey-frost-dM7JCxPvr8o-u | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a0b29c41a876db1055552_Greek-Chicken-Salad-p-500 | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/644805176660f8712e1aeb0a_tyrrell-fitness-and-nutri | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/642220b82bea3cbd26f4b89e_miu-sua-pO9851jklaE-unspl | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/644802d6daa9ff59b7c491c9_martin-adams-5XXfyMMan84- | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a06964d368e77c3d3df6d_Grilled%20Lemon%20Pepper% | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641b916c362b21414311a0df_camila-waz-lUR7ZYeZSG8-un | recipes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/62bf670d08f41115ca6c93d6_pinwheel-bakery-coffee-to | torrance-local-guide |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/62be523baea71c33fc00e4cf_torrance-beach-p-500.jpeg | torrance-local-guide |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/62bc76d17d7b7c47389480ef_pexels-rene-asmussen-2977 | torrance-local-guide |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/62be51fb511ff0478a8afed5_entradero-park-torrance-c | blog-4-best-public-parks-plus-1-beach-to-workout-in-torrance-ca |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/62be523baea71c33fc00e4cf_torrance-beach-p-800.jpeg | blog-4-best-public-parks-plus-1-beach-to-workout-in-torrance-ca |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/62be523baea71c33fc00e4cf_torrance-beach.jpeg as ht | blog-4-best-public-parks-plus-1-beach-to-workout-in-torrance-ca |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/62be51b8b4fe703609c6efdf_wilson-park-torrance-ca.j | blog-4-best-public-parks-plus-1-beach-to-workout-in-torrance-ca |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/642add807e245fef2b1375af_pexels-victor-freitas-791 | blog-4-best-public-parks-plus-1-beach-to-workout-in-torrance-ca |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/642ad6ea3e401a310dad4c35_pexels-karolina-grabowska | blog-4-best-public-parks-plus-1-beach-to-workout-in-torrance-ca |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf27a3b4eb5043/61846b3b19bf273842eb50c6_headhshot-default.jpg as  | coaches-scot-webb |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a120f448155e5a47c1821_pexels-nicola-barts-79369 | recipes-avocado-and-egg-breakfast-sandwich |
| performance | Re-hosted https://d3e54v103j8qbb.cloudfront.net/img/background-image.svg as https://pushpress-marketing-dev.s3.us-east-1 | recipes-avocado-and-egg-breakfast-sandwich |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641b93a8362b21176d11e48d_gil-ndjouwou-cueV_oTVsic- | recipes-baked-avocado-eggs |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a168fb3542ba156edcd79_mikey-frost-dM7JCxPvr8o-u | recipes-baked-eggs-with-spinach-and-feta |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/64480350f13e9f83b92fee59_jeff-ahmadi-Iq0rbPBXJ8Y-u | recipes-baked-salmon-with-honey-mustard-glaze |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a4b820f33b53901b17536_alex-munsell-Yr4n8O_3UPc- | recipes-broiled-pork-chops-with-roasted-vegetables |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641b981994d12b929fec7ffd_pinar-kucuk-Ae7jQFDTPk4-u | recipes-cauliflower-crust-pizza-with-pesto-and-roasted-vegetables |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a541d45baae3b333d896a_amber-faust--j-mhW_ZTZw-u | recipes-cauliflower-rice-stir-fry-with-shrimp-and-vegetables |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/64221cac5b697fce6b10fc03_chris-tweten-FK-UKNip0pE- | recipes-chicken-caesar-salad-with-greek-yogurt-dressing |
| performance | Re-hosted https://connect.facebook.net//log/error?p=pixel&sl=2&v=2.9.349&e=%5BMeta%20pixel%5D%20Bot%20traffic%20detected | recipes-chicken-caesar-salad-with-greek-yogurt-dressing |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/64221f2c2bea3c623cf497d0_bertrand-borie-47mkgWDly0 | recipes-eggplant-and-tomato-skillet |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641bab1b683a588104ab040c_vd-photography-5t6D43cwOc | recipes-energy-balls-with-dates-and-almonds |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/64221e2995ae3378db23b470_amie-bell-S52oLL51MxQ-uns | recipes-frozen-yogurt-bark |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a135dfdc7628666500f4f_Brussel%20Sprouts.webp as | recipes-garlic-roasted-brussel-sprouts |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a4fb935973721c85a44bd_roasted%20potato-p-800.jp | recipes-garlic-roasted-potatoes |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a0b29c41a876db1055552_Greek-Chicken-Salad-p-800 | recipes-greek-chicken-salad |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a5a1b9b82587d05f8820d_daniel-cabriles-Xboa6hvS_ | recipes-greek-yogurt-and-fruit-parfait |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641bae25c2f5a93f75c2fc9c_daniel-hooper-PaaboPF3dVY | recipes-grilled-chicken-with-avocado-and-tomato-salsa |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a06964d368e77c3d3df6d_Grilled%20Lemon%20Pepper% | recipes-grilled-lemon-pepper-salmon |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a19f5c7f9f275736024c9_salmon.webp as https://pu | recipes-grilled-salmon-with-avocado-salsa |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641ba68f13ab6e390541980b_grilled%20shrimp.jpg as h | recipes-grilled-shrimp-skewers-with-garlic-and-herbs |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641b886640b41fd109be4b26_kyle-mackie-1IxhHrTxbwI-u | recipes-grilled-steak-with-chimichurri-sauce |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a581cf414fdf9319d73ed_christopher-alvarenga-5uY | recipes-homemade-hummus-with-veggies |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a5930614c87ca3bcf5812_engin-akyurt-Jrvcg9My0B4- | recipes-keto-chicken-alfredo-zucchini-noodles |
| performance | Re-hosted https://cdn.prod.website-files.com/61846b3b19bf2706cbeb504a/641a0ccc457ee75ade588e69_Lemon%20Herb%20Grilled%20 | recipes-lemon-herb-grilled-chicken |

