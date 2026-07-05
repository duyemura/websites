# Pipeline Eval Report

**Date:** 2026-07-03  
**URLs file:** `/tmp/torrance-url.txt` (1 sites processed)  
**Stages:** extract → segment → docgen → build → verify  
**Pages:** /  
**LLM:** live

---

## 1. Summary

- Successful runs: 1/1
- Failed runs: 0/1
- Master fidelity (pre-heal): min 21, median 21.0, max 21
- Master fidelity (post-heal): min 38, median 38.0, max 38
- Self-heal effectiveness: 1/1 runs improved after re-running suggested stages
- Vision-usage rate: 100.0% of segmented pages (1/1)
- Rung-1 (semantic) section counts: min 1, median 1.0, max 1
- Total sections / URL: min 2, median 2.0, max 2

## 2. Per-URL results

| # | URL | Duration | Sections | Rung1 | Vision | Fidelity (pre) | Fidelity (post) | Failed stage |
|---|---|---|---|---|---|---|---|---|
| 1 | https://www.torrancetraininglab.com/ | 370.3s | 2 | 1 | yes | 21 | 38 |  |

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
| 20–39 | 1 |
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
| 20–39 | 1 |
| 40–59 | 0 |
| 60–69 | 0 |
| 70–79 | 0 |
| 80–89 | 0 |
| 90–99 | 0 |
| 100+ | 0 |

