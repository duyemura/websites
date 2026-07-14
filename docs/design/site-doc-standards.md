# Site doc standards

This document defines the required and optional contents for every doc produced during website replication / generation. Use it to audit scrapes, guide manual edits, and keep AI generators aligned.

Each standard lists: **key**, **purpose**, **required sections**, **optional sections**, and **success criteria**.

## Cross-cutting rules

- Docs are workspace-scoped, markdown, and may be linked to a site via `siteUuid`.
- Required sections must be present when the source data is available. Optional sections may be omitted if empty.
- All generated docs are `source: ai_extracted` and `status: active` until archived.
- Headings use sentence case (per PushPress UI copy rules).
- Links to other docs use `[[doc-key]]` notation so `assembleMasterContext` can resolve them.

---

## workspace-memory

**Purpose:** Workspace-level continuity. Human-readable business context, goals, and locked decisions that apply across every site in the workspace.

**Required sections:**

- `## About the business` — one-line business snapshot: name, industry, tagline, locations, top offerings.
- `## Current goal` — the single conversion or business goal AI should optimize for (e.g. free-trial signups, intro sessions, membership inquiries).
- `## Reference docs` — `[[brand-guidelines]]`, `[[business-info]]`, `[[site-strategy]]`, `[[blueprint-draft]]`.

**Optional sections:**

- `## About the user` — stakeholder name, role, email, notes.
- `## Brand positioning` — one-line positioning statement.
- `## Locked decisions` — non-negotiable choices (domain, colors, key messaging).
- `## Known blockers` — risks or missing info that could derail generation.
- `## Follow-up backlog` — open questions or next steps.

**Success criteria:** A stranger reading only this doc understands what the business is, what it wants from its website, and which docs hold the details.

---

## site-memory

**Purpose:** Site-level iteration log and state. One doc per site. Tracks purpose, source, QA issues, publish state, and recent edits.

**Required sections:**

- `## Site purpose` — why this site exists (conversion site, marketing site, etc.).
- `## Source` — URL replicated from, if any.
- `## Replication status` — what has been done (e.g. scraped, blueprint generated, built).
- `## Publish state` — draft / preview / published / archived.

**Optional sections:**

- `## Recent edits` — timestamped log of user or AI changes.
- `## QA issues` — problems detected or fixed during generation (missing images, no location, no offerings).
- `## Known placeholders` — copy or assets that still need replacement.
- `## Follow-up backlog` — per-site open tasks.

**Success criteria:** Anyone can see the site's current phase and what's blocking publish.

---

## brand-guidelines

**Purpose:** The single source of truth for visual identity and voice. Used by every generation job (website, SEO, brand review) and by the Astro renderer.

**Required sections:**

- `## Brand Overview` — name, tagline, industry, description, source note.
- `## Color System` — strategy + table with role, token name, hex, usage.
- `## Typography` — font table with role, family, weights, usage.
- `## Font Sizes & Type Scale` — element, mobile, tablet, desktop, notes.
- `## Tone of Voice` — voice summary, attributes, do/avoid guidance, keywords, and copy examples split into headlines and calls to action.
- `## Imagery` — imagery style, placement strategy, prompt keywords.
- `## Layout & Spacing` — layout rules and design tokens (spacing, radius, shadow, grid, etc.).
- `## Application Examples` — screenshot of source site + detected component patterns and concrete examples (button treatment, card format, nav style).

**Optional sections:**

- Additional screenshots beyond the primary full-page capture.
- Dark-mode behavior note.

**Success criteria:** A frontend developer could reproduce the site's look, feel, and copy voice from this doc alone.

---

## business-info

**Purpose:** Consolidated factual information about the business. Contains everything a customer or AI would need to populate pages.

**Required sections:**

- Business header: name, tagline, description.
- `## Contact` — phone, email, and social links (when available).
- `## Offerings` — services/programs with name, description, and price if listed.
- `## Locations` — name, address, hours if listed.

**Optional sections:**

- `## Team` — coach/staff profiles with name, role, bio, and optional photo reference.
- `## Testimonials` — quote blocks with author and role.
- `## FAQs` — question/answer pairs.
- `## Hours` — consolidated operating hours if not per-location.
- `## Social links` — may be merged into Contact if small.

**Success criteria:** All business facts needed for any page (homepage, about, contact, team, etc.) are in one place with no duplication.

---

## site-strategy

**Purpose:** The per-site plan of record for turning docs into a working, maintainable site. It is the document the site builder and page editor consult to understand what to build, in what order, and what is still uncertain. It is read by AI orchestrators and shown to users as a transparency log.

**Required sections:**

- `## Goal` — what success looks like for this site (conversion, replication, launch, etc.).
- `## Source` — URL and inputs this site is based on, if any.
- `## Site structure` — navigation links, page inventory, and IA from the source site.
- `## Build phases` — numbered checklist of phases with current status (scrape, blueprint, assets, code, build/QA, review/publish).
- `## Decisions to confirm` — open questions for the user or editor.
- `## Next action` — the single next step the system will take.

**Optional sections:**

- `## Site playbook` — conversion brief for the site: primary goal, ideal first action, ICP summary, top differentiators, offer/hook, trust assets, voice rules, and cross-page conversion patterns. This section is read by page generators to keep every page aligned on intent and action.
- `## Build conventions` — cross-page rules the editor should enforce (e.g. every page has a primary CTA, hero aspect ratio, max section count).
- `## Page templates` — reusable section patterns discovered in the source site.
- `## Launch checklist` — domain, DNS, meta, favicon, analytics, redirects.
- `## Rollback notes` — previous version references or known risks.

**Success criteria:** A user or AI can read this doc and know exactly what the site should contain, where the build stands, what is uncertain, and what will happen next. It should be clear enough that a new editor could pick up the site and continue building consistently.

---

## blueprint-draft

**Purpose:** Holds the validated JSON blueprint once generation runs. Starts as a placeholder after scrape.

**Required sections:**

- `## Placeholder` — valid JSON object with `site_metadata`, `design_tokens`, `global_shell`, `pages`.

**Optional after generation:**

- Per-page blueprints nested under `pages`.
- Component-level `component_variant` annotations.

**Success criteria:** The JSON is valid, complete, and can be passed directly to the Astro code generator.

---

## Audit checklist for any scrape

For every doc ask:

1. Does it exist?
2. Are all required sections present (given available data)?
3. Are required facts correct and non-redundant?
4. Is the tone/format consistent with this standard?
5. Does it contain placeholders, hallucinations, or missing data that should be flagged as QA issues?
6. Would another AI (e.g. the Astro generator or an SEO report generator) have everything it needs?

When a doc fails the audit, record the issue in `site-memory` under `## QA issues` and set the next action in `site-strategy`.
