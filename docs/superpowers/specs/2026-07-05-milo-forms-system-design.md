# Milo Forms System — Design

**Date:** 2026-07-05
**Status:** Approved for planning

## Goal

Make every form on a Milo-served site — mirrored (Hosted tier) and Astro template (Managed tier) — actually work: capture the submission, store it durably as a lead, notify the gym, and expose leads for a future dashboard and AI assistant.

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Lead destination | Milo-native leads table is the system of record. PushPress CRM sync is a later phase. |
| Capture mechanism (mirrored sites) | Injected JS interceptor, with the existing action-rewrite as no-JS/network-failure fallback. |
| Gym notification | AWS SES email + leads dashboard endpoint. |
| API compute | Single EC2 box in the unicorn AWS account, fronted by the existing CloudFront distribution. |
| Spam posture | Honeypot + per-IP rate limit + empty-body rejection. No CAPTCHA until real spam appears. |
| AI-readiness | Normalize `email`, `phone`, `name` into real columns at ingest; raw payload stays in JSONB. |

## Data flow

```
Visitor on mirrored/template site
  → submits form
  → interceptor catches submit, POSTs JSON to /api/forms/{siteUuid}/{formId}  (same-origin via CloudFront)
  → CloudFront behavior /api/* → EC2 origin (Fastify)
  → handleFormSubmission: honeypot → rate limit → normalize fields → INSERT into leads
  → BullMQ job lead-notify: SES email to gym owner
  → interceptor swaps form contents for inline success message
```

A lead is never lost to notification failure: the SES send is an async job with retries, fully decoupled from the ingest write.

## Components

### 1. Interceptor script (`milo-forms.js`, mirrored sites only)

Vanilla JS, ~2KB, no dependencies. Injected by the snapshot rewriter into every captured page and served from the site's own S3 asset prefix.

- Binds on `DOMContentLoaded` and watches a `MutationObserver` so forms rendered after load (Webflow, Wix embeds) are caught.
- **Skips non-lead forms:** `role="search"`, forms containing `type="password"`, forms with zero text/email/tel inputs.
- **Form identity:** deterministic `formId` = hash of (page path + form index + sorted field-name signature). Same form → same ID across snapshots; no registry required; leads group naturally per form.
- Serializes fields to JSON; appends UTM params from `sessionStorage` (same mechanism as the Astro template) and the honeypot field.
- **Success:** replaces the form's contents with an inline confirmation that inherits the page's styling. No Milo branding — it is the gym's site.
- **Failure:** lets the native submit proceed to the action-rewritten URL, which returns a minimal hosted thank-you page. The action-rewrite stage stays in the snapshot pipeline as this fallback.

The Astro template does NOT get the interceptor — `LeadForm.astro` already posts the same contract natively.

### 2. API changes

- **CloudFront:** new cache behavior `/api/*` → EC2 origin. Caching disabled, all HTTP methods, forward Host + query string. The KVS router function is unchanged — behavior matching happens before the function's S3 rewrite path applies to `/api/*` requests. Result: form posts are same-origin from every gym domain; no CORS anywhere.
- **`POST /forms/:siteUuid/:formId`:** accepts both JSON (interceptor, Astro fetch) and form-encoded (native fallback) bodies. Content-negotiates the response: `201 {ok: true}` for JSON/`Accept: application/json`, minimal hosted thank-you HTML for native form posts.
- **`GET /workspaces/:workspaceUuid/sites/:siteUuid/leads`:** paginated lead list with `formId` grouping and UTM attribution. This endpoint is the foundation for the future dashboard UI and AI assistant — both are out of scope now.
- Rate limiting stays in-memory. Correct on a single box; revisit only if the API scales out.

### 3. Leads schema additions

`leads` table gains normalized columns extracted at ingest by heuristic (input `type=email` / `type=tel`, common name-field patterns):

- `email` (nullable text)
- `phone` (nullable text)
- `name` (nullable text)

Raw payload remains complete in the existing `fields` JSONB. `formId`, `sourcePath`, and UTM attribution are already first-class. This makes the table uniformly queryable across gyms regardless of each site's arbitrary field names — the property a dashboard and AI assistant depend on.

`sites` table gains `notifyEmail` (nullable text). Null = dashboard-only, no notification job enqueued.

### 4. Notification (SES)

- New BullMQ queue `lead-notify`; worker renders a plain email (submitted fields + source page + UTM attribution) and sends via the AWS SES SDK, with BullMQ retry/backoff on failure.
- Manual setup tasks (documented in the plan, done once): verify sending domain in SES, enable DKIM, request production access (sandbox exit). Until sandbox exit, only verified recipients receive mail — sufficient for testing.

### 5. Deployment (single EC2)

- One instance in the unicorn AWS account running docker-compose: Milo monolith (API + worker), Postgres, Redis. Caddy (or nginx) terminates TLS on the origin.
- CloudFront `/api/*` origin points at this box.
- Deploy = `git pull && docker compose up -d --build` via a small script. No CI pipeline — right-sized for a side project.

### 6. Spam posture

Honeypot field (`_hp`) + per-IP in-memory rate limit (both exist) + reject submissions with zero non-honeypot fields. Cloudflare Turnstile is the designated drop-in if real spam appears. Nothing more now.

## Error handling

| Failure | Behavior |
|---|---|
| Interceptor fetch fails (network, 5xx) | Native submit proceeds to action-rewritten URL → hosted thank-you page. Lead captured via form-encoded path. |
| SES send fails | BullMQ retries with backoff; lead row already committed. |
| Honeypot filled / rate limited | 200-shaped response (don't tip off bots), no lead row. |
| No `notifyEmail` configured | Lead stored; no job enqueued. |

## Testing

- **Unit:** formId hashing determinism, lead-form detection heuristics against fixture HTML (Webflow, Wix, plain HTML), field normalization heuristics, payload serialization.
- **Integration:** POST both content types → lead row with normalized columns + `lead-notify` job enqueued; notification worker with mocked SES SDK; leads list endpoint pagination and auth.
- **E2E (eval harness):** after mirror deploy, Playwright fills and submits a real form on the CloudFront URL → assert lead row exists and the inline success message rendered. Added as a standard eval check.

## Out of scope (explicit)

- PushPress CRM sync (later phase — leads table and attribution columns are designed to feed it).
- Lead dashboard UI and AI assistant integration (build on `GET .../leads`).
- CAPTCHA/Turnstile.
- Multi-instance API scaling (in-memory rate limit assumes one box).
