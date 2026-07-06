# Pipeline Eval Report

**Date:** 2026-07-03  
**URLs file:** `/tmp/torrance-url.txt` (1 sites processed)  
**Stages:** extract → segment → docgen → build → verify  
**Pages:** /  
**LLM:** live

---

## 1. Summary

- Successful runs: 0/1
- Failed runs: 1/1
- Self-heal effectiveness: 0/0 runs improved after re-running suggested stages
- Vision-usage rate: 0.0% of segmented pages (0/0)

## 2. Per-URL results

| # | URL | Duration | Sections | Rung1 | Vision | Fidelity (pre) | Fidelity (post) | Failed stage |
|---|---|---|---|---|---|---|---|---|
| 1 | https://www.torrancetraininglab.com/ | 67.8s | 2 | 1 | yes | — | — | build |

## 3. Per-stage failures

| Stage | Failures |
|---|---|
| extract | 0 |
| segment | 0 |
| docgen | 0 |
| build | 1 |
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

## 5. Failure details

| URL | Failed stage | Error |
|---|---|---|
| https://www.torrancetraininglab.com/ | build | serveClone: no dist/ directory at /var/folders/9x/9ztsdt7128l8qc46qpg2hzx80000gp/T/ploy-gyms-build/99b5f81a-9d90-4c85-8230-9a60d3cf86c8/build/dist and no servedUrl provided |

