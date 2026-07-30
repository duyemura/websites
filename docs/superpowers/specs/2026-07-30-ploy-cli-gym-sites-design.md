# Ploy CLI gym sites — design spec
**Date:** 2026-07-30  
**Status:** Approved for PoC  
**Scope:** 10-gym proof of concept; foundation for scale to 5000+

---

## Problem

PushPress needs gym websites that are fast to create, great for SEO, and manageable at scale without a web dashboard. The question this PoC answers: can Ploy be the platform, or do we need to build our own?

---

## Decision

Run a 10-gym PoC using Ploy as the hosting and AI editing platform. Build `pp-sites` — a thin TypeScript CLI that wraps the Ploy CLI — to handle PushPress-specific workflows (bulk onboarding, Core data enrichment, agent-driven edits). Evaluate against five criteria. If they pass, scale. If not, we've spent two weeks to get a definitive answer.

---

## Architecture

```
pp-sites CLI
  ├── shells out to `ploy` binary (swap to Ploy HTTP API later)
  ├── calls PushPress Core API (gym data enrichment)
  └── triggers Ploybooks via webhook POST
```

**Workspace model:** one Ploy workspace per gym. This is the only model that supports:
- Gym-owner access (invite them to their workspace)
- Isolated Ploybooks, analytics, and billing per gym
- Clean churn/offboarding path

**Workspace creation gap:** `ploy workspace create` does not exist in the CLI today. Ploy will build it. For the 10-gym PoC, pre-create workspaces manually in the Ploy web UI and store the IDs in the CSV. When the command ships, remove the manual step.

---

## `pp-sites` CLI

### Commands

```bash
# Onboard a single gym
pp-sites onboard --company <pushpress_company_id> --url <website_url>

# Bulk onboard from CSV
pp-sites onboard --csv gyms.csv

# Trigger an on-demand edit via Ploy agent
pp-sites edit --company <pushpress_company_id> "<instruction>"

# Check site status
pp-sites status --company <pushpress_company_id>
```

### CSV format

```
gym_name, website_url, pushpress_company_id, ploy_workspace_id
```

The `ploy_workspace_id` column is a PoC workaround. Remove when `ploy workspace create` ships.

---

## Onboarding pipeline

Each gym — whether from CSV or single-gym command — runs the same five steps:

```
1. ploy workspace create --name <gym_name>       ← stubbed (manual) for PoC
2. ploy workspace use --id <workspace_id>
3. ploy site init --slurp <website_url> --wait   ← up to 15 min
4. pp-sites enrich (PushPress Core API → Ploybook webhook)
5. ploy site publish --wait
```

**Bulk concurrency:** CSV mode runs up to 5 gyms in parallel to avoid overwhelming Ploy's slurp queue. Failures are logged and skipped; a retry command is printed for each failure at the end.

**Step 4 — enrichment Ploybook:** called with a JSON payload containing gym name, address, phone, hours, class types, active plan names, and member headcount pulled from PushPress Core API. The Ploybook overwrites placeholder content (contact info, services section, nav labels) with real data before publish.

---

## Ongoing automation (Ploybooks)

Three Ploybooks run per gym after onboarding:

### 1. SEO pulse (weekly, scheduled)
- Queries GSC via Ploy integration: impressions, clicks, top queries, indexing status per page
- Stores structured report in Ploy CMS
- Triggers alert (Slack/email) if rankings drop below threshold
- No human needed unless alert fires

### 2. Content gap fill (monthly, scheduled)
- Finds keywords with impressions but poor rankings
- Identifies missing pages (e.g. "CrossFit classes in Austin" with no dedicated page)
- Drafts new pages and flags them for PushPress team review
- Human approves before publish

### 3. On-demand edit (triggered by `pp-sites edit`)
- Sets workspace/site context
- Passes instruction to Ploy agent
- Returns preview URL for review before publish

All three Ploybooks are parameterized by `pushpress_company_id` in the webhook payload. Because Ploybooks are workspace-scoped, each gym's workspace needs its own copy. For the 10-gym PoC, create them manually in each workspace. At scale, programmatic Ploybook creation is required — this is an open dependency (see below).

---

## Evaluation criteria (PoC exit gates)

All five must pass to proceed to scale:

| # | Criterion | Pass threshold |
|---|-----------|---------------|
| 1 | **Indexing speed** | All 10 sites in GSC within 14 days of publish |
| 2 | **Core Web Vitals** | LCP < 2.5s, CLS < 0.1 on mobile |
| 3 | **Brand keyword ranking** | Page 1 for `[gym name] [city]` within 60 days |
| 4 | **Edit time** | Meaningful content change via `pp-sites edit` in < 30 min, no dashboard |
| 5 | **Ploybook reliability** | Weekly SEO pulse runs unattended for 4 weeks |

**Outcome logic:**
- All 5 pass → scale to 100 gyms, request `ploy workspace create` from Ploy, design gym-owner bridge
- 1–2 fail → identify and fix the specific gaps
- 3+ fail → Ploy is not the platform; stop and re-evaluate

---

## Gym-owner bridge (deferred)

Long-term, gym owners access their site via PushPress Core — not the Ploy dashboard. A web-to-CLI bridge in Core would let gym owners issue instructions (edit, report, add page) that `pp-sites` executes against their workspace. Not in scope for PoC; design after scale validation.

---

## Open dependencies

1. **`ploy workspace create` CLI command** — needed for production scale; PoC works without it via manual pre-creation
2. **Ploy HTTP API** — if exposed publicly, replace shell-out calls with direct API calls; one function per `ploy` command to make the swap easy
3. **Programmatic Ploybook creation** — at scale, Ploybooks need to be created in each new gym's workspace automatically; for the PoC, create the 3 Ploybooks manually in each workspace
4. **PushPress Core API access** — enrichment step needs read access to gym profile, hours, class types, plans

---

## Out of scope

- Milo pipeline (this is Ploy-native, not Milo)
- Building our own hosting/CDN infrastructure
- Gym-owner bridge UI (deferred)
- White-label / custom branding of Ploy (evaluate post-PoC)
