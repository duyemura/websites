# Milo Forms System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every form on a Milo-served gym site capture lead submissions, store them durably, notify the gym owner via SES, and expose them through a paginated API endpoint.

**Architecture:** A vanilla-JS interceptor (`milo-forms.js`) is injected by the deploy pipeline into every mirrored page; it catches form submits, POSTs JSON to `POST /forms/:siteUuid/:formId`, and shows an inline success message. The Fastify handler normalizes the three high-value fields (email/phone/name) into dedicated columns and enqueues a BullMQ `lead_notify` job. The SES worker sends a plain notification email to the gym. A `GET /workspaces/:wsUuid/sites/:siteUuid/leads` endpoint exposes the leads for dashboard use. The Astro template's `LeadForm.astro` already posts the same contract — it is not touched.

**Tech Stack:** Node 24 TypeScript · Fastify 5 · Kysely · BullMQ · `@aws-sdk/client-ses` · Vitest · Cheerio (already installed)

---

## File map

| File | Action | Purpose |
|---|---|---|
| `apps/api/src/migrations/20260705000001_leads_normalize.ts` | **Create** | Add `email`, `phone`, `name` to `leads`; add `notify_email` to `sites` |
| `apps/api/src/types/db.ts` | **Regen** (`pnpm codegen:db`) | Sync Kysely types after migration |
| `apps/api/src/services/leads.ts` | **Modify** | Normalize fields; accept `enqueueNotify` callback; add `listLeads` query |
| `apps/api/src/api/routes/forms.ts` | **Modify** | Accept JSON body; return `201 {ok:true}` for JSON; keep 303 for form-encoded |
| `apps/api/src/api/routes/leads.ts` | **Create** | `GET /workspaces/:wUuid/sites/:sUuid/leads` |
| `apps/api/src/api/index.ts` | **Modify** | Register new leads route |
| `apps/api/src/utils/mirror/interceptor.ts` | **Create** | Exports interceptor JS as a string constant |
| `apps/api/src/services/mirror/deploy.ts` | **Modify** | Upload `milo-forms.js`; inject interceptor + form-fallback synthetic transforms |
| `apps/api/src/plugins/env.ts` | **Modify** | Add `SES_FROM_EMAIL` env var |
| `apps/api/src/plugins/queues.ts` | **Modify** | Add `lead_notify` queue + QueueConfig declaration |
| `apps/api/src/worker/workers/notify-lead.ts` | **Create** | BullMQ worker — sends SES email |
| `apps/api/src/worker/index.ts` | **Check** | AutoLoad picks up new worker automatically — no change needed |
| `apps/api/src/services/__tests__/leads.test.ts` | **Create** | Unit + integration tests for normalization and list |
| `apps/api/src/utils/mirror/__tests__/interceptor.test.ts` | **Create** | Vitest tests for interceptor JS via jsdom |

---

## Task 1: Migration — normalized lead columns + notify_email

**Files:**
- Create: `apps/api/src/migrations/20260705000001_leads_normalize.ts`

- [ ] **Step 1: Write the migration**

```typescript
// apps/api/src/migrations/20260705000001_leads_normalize.ts
import { type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("leads")
    .addColumn("email", "text")
    .addColumn("phone", "text")
    .addColumn("name", "text")
    .execute();

  await db.schema
    .alterTable("sites")
    .addColumn("notify_email", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("leads").dropColumn("email").execute();
  await db.schema.alterTable("leads").dropColumn("phone").execute();
  await db.schema.alterTable("leads").dropColumn("name").execute();
  await db.schema.alterTable("sites").dropColumn("notify_email").execute();
}
```

- [ ] **Step 2: Run the migration**

```bash
cd apps/api && pnpm migrate
```

Expected: migration runs with no error; `leads` table now has `email`, `phone`, `name` columns; `sites` table has `notify_email`.

- [ ] **Step 3: Regenerate Kysely types**

```bash
cd apps/api && pnpm codegen:db
```

Expected: `src/types/db.ts` updated. Verify these changes appear in the `Leads` interface:
```
email: string | null;
phone: string | null;
name: string | null;
```
And in `Sites`:
```
notifyEmail: string | null;
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/migrations/20260705000001_leads_normalize.ts apps/api/src/types/db.ts
git commit -m "feat(forms): migration — normalized lead columns + notify_email on sites"
```

---

## Task 2: Update leads service — field normalization + notify enqueue

**Files:**
- Modify: `apps/api/src/services/leads.ts`
- Test: `apps/api/src/services/__tests__/leads.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/__tests__/leads.test.ts
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "../../database";
import { handleFormSubmission, listLeads } from "../leads";

describe("leads service", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ws = await db
      .insertInto("workspaces")
      .values({ name: "Test Gym", slug: `test-gym-${Date.now()}` })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    workspaceUuid = ws.uuid;

    const site = await db
      .insertInto("sites")
      .values({ name: "Test Site", slug: `test-site-${Date.now()}`, workspaceUuid })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  afterEach(async () => {
    await db.deleteFrom("leads").where("siteUuid", "=", siteUuid).execute();
    await db.deleteFrom("sites").where("uuid", "=", siteUuid).execute();
    await db.deleteFrom("workspaces").where("uuid", "=", workspaceUuid).execute();
  });

  test("stores lead and normalizes email, phone, name", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid,
      formId: "form-abc",
      fields: {
        email: "jane@gym.com",
        phone: "555-1234",
        name: "Jane Smith",
        message: "I'd like to sign up",
      },
      sourcePath: "/contact",
      ip: "1.2.3.4",
    });
    expect(result.stored).toBe(true);

    const row = await db
      .selectFrom("leads")
      .selectAll()
      .where("siteUuid", "=", siteUuid)
      .executeTakeFirstOrThrow();

    expect(row.email).toBe("jane@gym.com");
    expect(row.phone).toBe("555-1234");
    expect(row.name).toBe("Jane Smith");
    expect((row.fields as Record<string, unknown>)["message"]).toBe("I'd like to sign up");
  });

  test("drops honeypot submissions", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid,
      formId: "form-abc",
      fields: { _hp: "bot@spam.com", email: "bot@spam.com" },
      sourcePath: null,
      ip: "1.2.3.4",
    });
    expect(result.stored).toBe(false);
    const count = await db
      .selectFrom("leads")
      .select(({ fn }) => [fn.countAll().as("n")])
      .where("siteUuid", "=", siteUuid)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(0);
  });

  test("normalizes fields by common name patterns", async () => {
    await handleFormSubmission(db, {
      siteUuid,
      formId: "form-webflow",
      fields: { "your-email": "test@example.com", "full-name": "Bob", "your-phone": "999-0000" },
      sourcePath: "/",
      ip: null,
    });
    const row = await db
      .selectFrom("leads")
      .selectAll()
      .where("siteUuid", "=", siteUuid)
      .executeTakeFirstOrThrow();
    expect(row.email).toBe("test@example.com");
    expect(row.name).toBe("Bob");
    expect(row.phone).toBe("999-0000");
  });

  test("listLeads returns leads for a site, newest first", async () => {
    await handleFormSubmission(db, {
      siteUuid, formId: "f1",
      fields: { email: "a@a.com" }, sourcePath: "/", ip: null,
    });
    await handleFormSubmission(db, {
      siteUuid, formId: "f2",
      fields: { email: "b@b.com" }, sourcePath: "/about", ip: null,
    });
    const page = await listLeads(db, { siteUuid, workspaceUuid, page: 1, limit: 10 });
    expect(page.total).toBe(2);
    expect(page.leads.length).toBe(2);
    expect(page.leads[0].email).toBe("b@b.com"); // newest first
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/api && pnpm test --no-file-parallelism src/services/__tests__/leads.test.ts
```

Expected: FAIL — `listLeads` not exported, normalized columns not set.

- [ ] **Step 3: Rewrite `leads.ts`**

`handleFormSubmission` accepts an optional `enqueueNotify` callback so the service stays pure (no BullMQ import, no Redis connection), and the queue injection happens at the call site (the Fastify route).

```typescript
// apps/api/src/services/leads.ts
import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { jsonb } from "../utils/jsonb";

export interface FormSubmission {
  siteUuid: string;
  formId: string;
  fields: Record<string, unknown>;
  sourcePath: string | null;
  ip: string | null;
}

export interface FormSubmissionOpts {
  /** Called after the lead is persisted, only when site.notifyEmail is set. */
  enqueueNotify?: (leadUuid: string, siteUuid: string) => Promise<void>;
}

function normalizeFields(fields: Record<string, unknown>): {
  email: string | null;
  phone: string | null;
  name: string | null;
} {
  const find = (pattern: RegExp): string | null => {
    for (const [key, val] of Object.entries(fields)) {
      if (key === "_hp") continue;
      if (pattern.test(key.toLowerCase()) && typeof val === "string" && val.trim()) {
        return val.trim();
      }
    }
    return null;
  };
  return {
    email: find(/email/),
    phone: find(/phone|mobile|tel/),
    name: find(/^(full[_-]?name|your[_-]?name|name|first[_-]?name)$/),
  };
}

export async function handleFormSubmission(
  db: Kysely<DB>,
  submission: FormSubmission,
  opts: FormSubmissionOpts = {},
): Promise<{ stored: boolean }> {
  const hp = submission.fields["_hp"];
  if (typeof hp === "string" && hp.length > 0) return { stored: false };

  const site = await db
    .selectFrom("sites")
    .select(["uuid", "workspaceUuid", "notifyEmail"])
    .where("uuid", "=", submission.siteUuid)
    .executeTakeFirst();
  if (!site) return { stored: false };

  const { _hp, ...fields } = submission.fields;
  void _hp;
  const { email, phone, name } = normalizeFields(fields);

  const lead = await db
    .insertInto("leads")
    .values({
      siteUuid: site.uuid,
      workspaceUuid: site.workspaceUuid,
      formId: submission.formId,
      fields: jsonb(fields),
      sourcePath: submission.sourcePath,
      ip: submission.ip,
      email,
      phone,
      name,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();

  if (site.notifyEmail && opts.enqueueNotify) {
    await opts.enqueueNotify(lead.uuid, site.uuid);
  }

  return { stored: true };
}

export interface LeadPage {
  leads: {
    uuid: string;
    formId: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    sourcePath: string | null;
    fields: unknown;
    createdAt: Date;
  }[];
  total: number;
  page: number;
  limit: number;
}

export async function listLeads(
  db: Kysely<DB>,
  opts: { siteUuid: string; workspaceUuid: string; page: number; limit: number; formId?: string },
): Promise<LeadPage> {
  let q = db
    .selectFrom("leads")
    .where("siteUuid", "=", opts.siteUuid)
    .where("workspaceUuid", "=", opts.workspaceUuid);

  if (opts.formId) q = q.where("formId", "=", opts.formId);

  const [rows, countRow] = await Promise.all([
    q
      .select(["uuid", "formId", "email", "phone", "name", "sourcePath", "fields", "createdAt"])
      .orderBy("createdAt", "desc")
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit)
      .execute(),
    q.select(({ fn }) => [fn.countAll<string>().as("n")]).executeTakeFirstOrThrow(),
  ]);

  return {
    leads: rows.map((r) => ({
      uuid: r.uuid,
      formId: r.formId,
      email: r.email,
      phone: r.phone,
      name: r.name,
      sourcePath: r.sourcePath,
      fields: r.fields,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    })),
    total: Number(countRow.n),
    page: opts.page,
    limit: opts.limit,
  };
}
```

- [ ] **Step 4: No separate helper needed**

`leads.ts` takes an optional callback — no queue import, no helper file. The forms route (Task 3) will pass the callback from `fastify.queues.leadNotify.queue.add(...)`. Skip to Step 5.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd apps/api && pnpm test --no-file-parallelism src/services/__tests__/leads.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/leads.ts apps/api/src/services/__tests__/leads.test.ts
git commit -m "feat(forms): normalize lead fields, listLeads query, notify callback"
```

---

## Task 3: Update forms route — JSON body + 201 response

**Files:**
- Modify: `apps/api/src/api/routes/forms.ts`

- [ ] **Step 1: Replace `forms.ts`**

The route must accept both `application/json` (from the interceptor) and `application/x-www-form-urlencoded` (native fallback). Fastify already has `@fastify/formbody` registered. Add JSON body parsing and content-negotiate the response.

```typescript
// apps/api/src/api/routes/forms.ts
import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import formbody from "@fastify/formbody";
import { handleFormSubmission } from "../../services/leads";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

const THANK_YOU_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="robots" content="noindex"><title>Thank you</title></head>
<body style="font-family:sans-serif;text-align:center;padding:4rem">
<h1>Thanks — we’ll be in touch!</h1></body></html>`;

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  void fastify.register(formbody);

  fastify.post(
    "/forms/:siteUuid/:formId",
    {
      schema: {
        params: z.object({ siteUuid: z.string().uuid(), formId: z.string().max(200) }),
      },
    },
    async (request, reply) => {
      const ip = request.ip;
      if (rateLimited(ip)) {
        // Behave identically to a successful submission — don't tip off bots.
        const acceptsJson = (request.headers.accept ?? "").includes("application/json");
        return acceptsJson
          ? reply.code(201).send({ ok: true })
          : reply.code(200).type("text/html").send(THANK_YOU_HTML);
      }

      const { siteUuid, formId } = request.params;
      const fields = (request.body ?? {}) as Record<string, unknown>;
      const referer = typeof request.headers.referer === "string" ? request.headers.referer : null;
      let sourcePath: string | null = null;
      try {
        sourcePath = referer ? new URL(referer).pathname : null;
      } catch { /* bad referer */ }

      const result = await handleFormSubmission(
        fastify.db,
        { siteUuid, formId, fields, sourcePath, ip },
        {
          enqueueNotify: (leadUuid, sid) =>
            fastify.queues.leadNotify.queue.add("notify", { leadUuid, siteUuid: sid }).then(() => undefined),
        },
      );
      if (result.stored) fastify.log.info({ siteUuid, formId }, "lead captured");

      const acceptsJson = (request.headers.accept ?? "").includes("application/json");
      if (acceptsJson) {
        return reply.code(201).send({ ok: true });
      }

      // Native form-encoded path: redirect to referer with ?submitted=1, or serve thank-you page
      if (referer) {
        try {
          const back = new URL(referer);
          back.searchParams.set("submitted", "1");
          return reply.code(303).redirect(back.toString());
        } catch { /* fall through */ }
      }
      return reply.code(200).type("text/html").send(THANK_YOU_HTML);
    },
  );

  done();
};

export default app;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/api/routes/forms.ts
git commit -m "feat(forms): accept JSON body, 201 response for interceptor path"
```

---

## Task 4: Leads list endpoint

**Files:**
- Create: `apps/api/src/api/routes/leads.ts`

The workspace auth hook in `apps/api/src/api/plugins/workspace.ts` already runs on all routes; this endpoint is automatically protected — no additional auth logic needed.

- [ ] **Step 1: Create `leads.ts` route**

```typescript
// apps/api/src/api/routes/leads.ts
import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { listLeads } from "../../services/leads";

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/workspaces/:workspaceUuid/sites/:siteUuid/leads",
    {
      schema: {
        params: z.object({
          workspaceUuid: z.string().uuid(),
          siteUuid: z.string().uuid(),
        }),
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          formId: z.string().max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { workspaceUuid, siteUuid } = request.params;
      const { page, limit, formId } = request.query;

      // Verify the site belongs to this workspace
      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!site) return reply.code(404).send({ error: "Site not found" });

      const result = await listLeads(fastify.db, { siteUuid, workspaceUuid, page, limit, formId });
      return reply.code(200).send(result);
    },
  );

  done();
};

export default app;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

Expected: no type errors. The AutoLoad in `apps/api/src/api/index.ts` picks up this file automatically — no registration change needed.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/api/routes/leads.ts
git commit -m "feat(forms): GET /workspaces/:wUuid/sites/:sUuid/leads endpoint"
```

---

## Task 5: Interceptor script

**Files:**
- Create: `apps/api/src/utils/mirror/interceptor.ts`
- Test: `apps/api/src/utils/mirror/__tests__/interceptor.test.ts`

The interceptor is vanilla JS (no TypeScript, no dependencies) exported as a string constant so the deploy stage can upload it to S3. Tests run it in a jsdom environment via Vitest's `environment: 'jsdom'` option.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/utils/mirror/__tests__/interceptor.test.ts
// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from "vitest";
import { INTERCEPTOR_SCRIPT } from "../interceptor";

function evalInPage(siteUuid: string, extraHtml = ""): void {
  // Set up the script tag the interceptor reads to find siteUuid
  const scriptEl = document.createElement("script");
  scriptEl.src = "/_assets/milo-forms.js";
  scriptEl.dataset.siteUuid = siteUuid;
  document.head.appendChild(scriptEl);
  document.body.innerHTML = extraHtml;
  // eval the interceptor
  // eslint-disable-next-line no-new-func
  new Function(INTERCEPTOR_SCRIPT)();
  // Trigger DOMContentLoaded equivalent (script runs after DOM is ready in jsdom)
}

describe("milo-forms interceptor", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    vi.stubGlobal("fetch", vi.fn());
    sessionStorage.clear();
  });

  test("intercepts a lead form and posts JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    evalInPage("site-123", `
      <form id="lead">
        <input name="email" type="email" value="jane@gym.com" />
        <input name="name" type="text" value="Jane" />
        <input name="_hp" type="text" value="" />
        <button type="submit">Submit</button>
      </form>
    `);

    const form = document.getElementById("lead") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await new Promise((r) => setTimeout(r, 0)); // flush microtasks

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^\/api\/forms\/site-123\//);
    const body = JSON.parse(opts.body as string) as Record<string, string>;
    expect(body["email"]).toBe("jane@gym.com");
    expect(body["name"]).toBe("Jane");
  });

  test("skips forms with a password field", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    evalInPage("site-123", `
      <form>
        <input name="username" type="text" value="user" />
        <input name="password" type="password" value="secret" />
        <button type="submit">Login</button>
      </form>
    `);

    const form = document.querySelector("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("skips search forms", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    evalInPage("site-123", `
      <form role="search">
        <input name="q" type="text" value="yoga" />
        <button type="submit">Search</button>
      </form>
    `);

    const form = document.querySelector("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("includes utm params from sessionStorage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem("milo_utm", JSON.stringify({ utm_source: "instagram" }));

    evalInPage("site-123", `
      <form>
        <input name="email" type="email" value="x@x.com" />
        <button type="submit">Go</button>
      </form>
    `);

    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, string>;
    expect(body["utm_source"]).toBe("instagram");
  });

  test("same form always produces same formId", () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      document.body.innerHTML = `
        <form>
          <input name="email" type="email" value="a@b.com" />
          <button type="submit">Go</button>
        </form>
      `;
      document.head.innerHTML = "";
      evalInPage("site-xyz");
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      const url = (fetchMock.mock.calls[0] as [string, RequestInit])[0] as string;
      ids.push(url.split("/").pop()!);
    }
    expect(ids[0]).toBe(ids[1]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/api && pnpm test --no-file-parallelism src/utils/mirror/__tests__/interceptor.test.ts
```

Expected: FAIL — `INTERCEPTOR_SCRIPT` not found.

- [ ] **Step 3: Create the interceptor**

```typescript
// apps/api/src/utils/mirror/interceptor.ts

export const INTERCEPTOR_SCRIPT = /* js */ `(function () {
  var scriptEl = document.querySelector('script[src*="milo-forms.js"]');
  var siteUuid = scriptEl && scriptEl.dataset ? scriptEl.dataset.siteUuid : '';
  if (!siteUuid) return;

  var endpoint = '/api/forms/' + siteUuid + '/';

  // Capture UTM params from current URL into sessionStorage on every page load
  (function () {
    try {
      var p = new URLSearchParams(window.location.search);
      var utm = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        var v = p.get(k);
        if (v) utm[k] = v;
      });
      if (Object.keys(utm).length > 0) {
        sessionStorage.setItem('milo_utm', JSON.stringify(utm));
      }
    } catch (e) {}
  })();

  function getUtm() {
    try { return JSON.parse(sessionStorage.getItem('milo_utm') || '{}'); } catch (e) { return {}; }
  }

  function djb2(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h, 33) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(36);
  }

  function getFormId(form, index) {
    var names = [];
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var n = els[i].name;
      if (n && n !== '_hp') names.push(n);
    }
    names.sort();
    return djb2((window.location.pathname || '/') + ':' + index + ':' + names.join(','));
  }

  function isLeadForm(form) {
    if (form.getAttribute('role') === 'search') return false;
    if (form.querySelector('input[type="password"]')) return false;
    var inputs = form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], textarea'
    );
    return inputs.length > 0;
  }

  function showSuccess(form) {
    var p = document.createElement('p');
    p.textContent = 'Thanks — we’ll be in touch.';
    if (form.parentNode) form.parentNode.replaceChild(p, form);
  }

  function wireForm(form, index) {
    if (form.__miloWired) return;
    if (!isLeadForm(form)) return;
    form.__miloWired = true;

    form.addEventListener('submit', function handler(e) {
      e.preventDefault();
      var formId = getFormId(form, index);
      var data = {};
      var els = form.elements;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el.name) continue;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
        data[el.name] = el.value;
      }
      Object.assign(data, getUtm());

      fetch(endpoint + formId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data),
      }).then(function (res) {
        if (res.ok) {
          showSuccess(form);
        } else {
          form.removeEventListener('submit', handler);
          form.__miloWired = false;
          form.submit();
        }
      }).catch(function () {
        form.removeEventListener('submit', handler);
        form.__miloWired = false;
        form.submit();
      });
    });
  }

  function wireAll() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      wireForm(forms[i], i);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAll);
  } else {
    wireAll();
  }

  if (window.MutationObserver) {
    new MutationObserver(wireAll).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();`;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/api && pnpm test --no-file-parallelism src/utils/mirror/__tests__/interceptor.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/mirror/interceptor.ts apps/api/src/utils/mirror/__tests__/interceptor.test.ts
git commit -m "feat(forms): interceptor script with form detection, formId hashing, UTM, success UX"
```

---

## Task 6: Inject interceptor in deploy stage

**Files:**
- Modify: `apps/api/src/services/mirror/deploy.ts`

This task uploads `milo-forms.js` to every deploy prefix and injects it into every page via two synthetic transforms: a `head-inject` for the script tag and a `form-route` for the native fallback action.

- [ ] **Step 1: Add imports and synthetic transform factory to `deploy.ts`**

At the top of `apps/api/src/services/mirror/deploy.ts`, add the import:

```typescript
import { INTERCEPTOR_SCRIPT } from "../../utils/mirror/interceptor";
```

After the existing `NOINDEX_TRANSFORM` constant and `SYNTHETIC_IDS` set, add:

```typescript
function makeInterceptorTransforms(siteUuid: string): SiteTransformRecord[] {
  return [
    {
      uuid: "synthetic-interceptor",
      ordinal: 0,
      type: "head-inject" as TransformType,
      pageGlob: "/*",
      selector: null,
      payload: {
        html: `<script src="/_assets/milo-forms.js" data-site-uuid="${siteUuid}" defer></script>`,
      },
      status: "active" as const,
    },
    {
      uuid: "synthetic-form-fallback",
      ordinal: 1,
      type: "form-route" as TransformType,
      pageGlob: "/*",
      selector: "form",
      payload: { action: `/api/forms/${siteUuid}/fallback` },
      status: "active" as const,
    },
  ];
}
```

Also add the two new UUIDs to `SYNTHETIC_IDS`:

```typescript
const SYNTHETIC_IDS = new Set([
  "synthetic-noindex",
  "synthetic-interceptor",
  "synthetic-form-fallback",
]);
```

- [ ] **Step 2: Wire synthetic transforms into `deploySnapshot`**

In `deploySnapshot`, replace the existing `transforms` assignment:

```typescript
// Before (line ~87):
const transforms = deps.preview ? [NOINDEX_TRANSFORM, ...dbTransforms] : dbTransforms;
```

With:

```typescript
const interceptorTransforms = makeInterceptorTransforms(deps.siteUuid);
const transforms = deps.preview
  ? [NOINDEX_TRANSFORM, ...interceptorTransforms, ...dbTransforms]
  : [...interceptorTransforms, ...dbTransforms];
```

- [ ] **Step 3: Upload `milo-forms.js` to the deploy prefix**

In `deploySnapshot`, after the asset copy loop (the `do { ... } while (token)` block that copies from `${snapshot.s3Prefix}/assets/`), add the interceptor upload:

```typescript
// Upload the interceptor script alongside the site assets
try {
  await deps.s3Client.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: `${deployPrefix}/_assets/milo-forms.js`,
      Body: Buffer.from(INTERCEPTOR_SCRIPT, "utf8"),
      ContentType: "application/javascript; charset=utf-8",
    }),
  );
} catch (err) {
  warnings.push(`interceptor upload failed: ${err instanceof Error ? err.message : String(err)}`);
}
```

- [ ] **Step 4: Also copy interceptor into `promoteDeploy`'s source**

`promoteDeploy` copies everything under `${deployPrefix}/` to `current/`, so `_assets/milo-forms.js` is automatically included. No change needed there — verify by reviewing `promoteDeploy`'s copy loop uses `Prefix: \`${deployPrefix}/\`` which covers all subdirectories.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/mirror/deploy.ts
git commit -m "feat(forms): inject interceptor script + form-fallback action into every mirror deploy"
```

---

## Task 7: SES notification worker

**Files:**
- Modify: `apps/api/src/plugins/env.ts`
- Modify: `apps/api/src/plugins/queues.ts`
- Create: `apps/api/src/worker/workers/notify-lead.ts`

**Prerequisite — install the SES SDK:**

```bash
cd apps/api && pnpm add @aws-sdk/client-ses
```

- [ ] **Step 1: Add `SES_FROM_EMAIL` to env schema**

In `apps/api/src/plugins/env.ts`, add to `ConfigSchema`:

```typescript
SES_FROM_EMAIL: z.string().email().optional(),
```

Place it after the `FAL_IMAGE_MODEL` line. `optional()` means the worker is silently skipped if the var is not set — the `notifyEmail` guard in `leads.ts` prevents jobs from being enqueued without it anyway.

- [ ] **Step 2: Add `lead_notify` to `queues.ts`**

In `apps/api/src/plugins/queues.ts`, add the queue build call:

```typescript
const leadNotify = bull.build("lead_notify");
```

Add it to the `fastify.decorate("queues", { ... })` object:

```typescript
leadNotify,
```

Add the QueueConfig declaration inside `declare module "../bullmq"`:

```typescript
lead_notify: {
  data: { leadUuid: string; siteUuid: string };
  result: { sent: boolean };
};
```

Add the FastifyInstance declaration:

```typescript
leadNotify: ReturnType<typeof bull.build<"lead_notify">>;
```

- [ ] **Step 3: Create the notify-lead worker**

```typescript
// apps/api/src/worker/workers/notify-lead.ts
import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { QueueConfig } from "../../bullmq";

export function notifyLeadProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["lead_notify"]["data"]>): Promise<{ sent: boolean }> => {
    const { leadUuid, siteUuid } = job.data;
    const fromEmail = fastify.config.SES_FROM_EMAIL;
    if (!fromEmail) {
      fastify.log.warn({ leadUuid }, "SES_FROM_EMAIL not configured — skipping notification");
      return { sent: false };
    }

    const lead = await fastify.db
      .selectFrom("leads")
      .select(["uuid", "email", "phone", "name", "sourcePath", "fields", "createdAt", "formId"])
      .where("uuid", "=", leadUuid)
      .executeTakeFirst();

    if (!lead) {
      fastify.log.warn({ leadUuid }, "Lead not found — skipping notification");
      return { sent: false };
    }

    const site = await fastify.db
      .selectFrom("sites")
      .select(["name", "notifyEmail"])
      .where("uuid", "=", siteUuid)
      .executeTakeFirst();

    if (!site?.notifyEmail) {
      fastify.log.warn({ leadUuid, siteUuid }, "Site has no notifyEmail — skipping");
      return { sent: false };
    }

    const fields = lead.fields as Record<string, unknown>;
    const fieldLines = Object.entries(fields)
      .filter(([k]) => k !== "_hp")
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join("\n");

    const ses = new SESClient({ region: fastify.config.S3_REGION });
    const subject = `New lead from ${site.name}`;
    const body = [
      `New lead on ${site.name}`,
      ``,
      `Name:  ${lead.name ?? "(not captured)"}`,
      `Email: ${lead.email ?? "(not captured)"}`,
      `Phone: ${lead.phone ?? "(not captured)"}`,
      `Page:  ${lead.sourcePath ?? "(unknown)"}`,
      ``,
      `All fields:`,
      fieldLines,
    ].join("\n");

    await ses.send(
      new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [site.notifyEmail] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: body, Charset: "UTF-8" } },
        },
      }),
    );

    fastify.log.info({ leadUuid, to: site.notifyEmail }, "Lead notification sent");
    return { sent: true };
  };
}
```

- [ ] **Step 4: Register the worker**

The workers directory is auto-loaded. Open `apps/api/src/worker/workers/notify-lead.ts` and confirm it exports a function named `notifyLeadProcessor`. The AutoLoad mechanism expects a default export or a named export that is a Fastify plugin. Check how the other workers are registered:

```bash
head -20 apps/api/src/worker/workers/mirror-site.ts
```

The pattern in this codebase is that each worker file is a Fastify plugin registered via AutoLoad. Create the plugin wrapper:

```typescript
// Append to the bottom of notify-lead.ts (replace the raw function export above with this):
import fp from "fastify-plugin";

export default fp(
  (fastify, _, done) => {
    fastify.queues.leadNotify.worker.run(notifyLeadProcessor(fastify));
    done();
  },
  { name: "notify-lead-worker", dependencies: ["queues"] },
);
```

> **Note:** The full file should have `notifyLeadProcessor` defined first (as above), then the `fp(...)` default export that wires it up.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api && pnpm build 2>&1 | head -20
```

Expected: no type errors. If `@aws-sdk/client-ses` types are missing, run `pnpm add -D @types/aws-sdk` — though the v3 SDK ships its own types, so this should not be needed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/plugins/env.ts apps/api/src/plugins/queues.ts apps/api/src/worker/workers/notify-lead.ts
git commit -m "feat(forms): SES lead notification worker + lead_notify queue"
```

---

## Task 8: Eval harness — form submission check

**Files:**
- Modify: `apps/api/scripts/eval/run-mirror.ts`

After mirroring a site, the eval harness should verify that form capture works end-to-end: POST a test lead, assert 201, assert the row exists in the DB.

- [ ] **Step 1: Read the eval script to find the right extension point**

```bash
head -80 apps/api/scripts/eval/run-mirror.ts
```

Look for where the per-page checks happen and where the final summary is printed. The form check should run once after the mirror eval loop, not per-page.

- [ ] **Step 2: Add a form capture check to the eval**

Find the section after the per-page eval loop completes (around the summary print). Add:

```typescript
// Form capture smoke-test: POST a test lead, assert 201 + row lands in DB
console.log("\n## Form capture check");
try {
  const formRes = await fetch(
    `${cdnBase}/api/forms/${siteUuid}/eval-smoke-test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: "eval@milotest.com", name: "Eval Test", _hp: "" }),
    },
  );
  if (formRes.status === 201) {
    // Verify row in DB
    const row = await db
      .selectFrom("leads")
      .select("uuid")
      .where("siteUuid", "=", siteUuid)
      .where("formId", "=", "eval-smoke-test")
      .where("email", "=", "eval@milotest.com")
      .orderBy("createdAt", "desc")
      .executeTakeFirst();
    if (row) {
      console.log("✅ Form capture: lead stored (uuid:", row.uuid, ")");
      // Clean up test lead
      await db.deleteFrom("leads").where("uuid", "=", row.uuid).execute();
    } else {
      console.log("❌ Form capture: 201 but lead row not found in DB");
    }
  } else {
    console.log(`❌ Form capture: expected 201, got ${formRes.status}`);
  }
} catch (err) {
  console.log("❌ Form capture: fetch failed —", err instanceof Error ? err.message : String(err));
}
```

> **Note:** `cdnBase` must include the `/api` routing path through CloudFront. If CloudFront does not yet have the `/api/*` behavior pointing to the EC2 origin (Task 9), this check will fail with a network error. The Eval will still pass the mirror checks — only the form check will show ❌ until the CloudFront behavior is wired.

- [ ] **Step 3: Run the eval to confirm the rest still passes**

```bash
cd apps/api && npx tsx scripts/eval/run-mirror.ts --site torrancetraininglab.com
```

Expected: existing mirror checks still ALL PASS; form check shows ❌ (expected — CloudFront `/api/*` not yet configured) or ✅ if API is reachable locally.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/eval/run-mirror.ts
git commit -m "feat(forms): eval harness form capture smoke-test"
```

---

## Task 9: CloudFront `/api/*` origin behavior (manual AWS steps)

This is infrastructure configuration, not code. Document and execute these steps once the EC2 box is running.

- [ ] **Step 1: Get the current CloudFront distribution config**

```bash
AWS_PROFILE=unicorn aws cloudfront get-distribution-config \
  --id E1JA0JAUI27AQG \
  --output json > /tmp/cf-config.json
```

- [ ] **Step 2: Add the EC2 origin and `/api/*` cache behavior**

Write a Python script to patch the config (`/tmp/patch-cf-api.py`):

```python
import json, boto3, sys

with open("/tmp/cf-config.json") as f:
    data = json.load(f)

etag = data["ETag"]
config = data["DistributionConfig"]

EC2_DOMAIN = "YOUR_EC2_PUBLIC_DNS_OR_IP"  # e.g. ec2-1-2-3-4.compute-1.amazonaws.com

# Add EC2 origin
config["Origins"]["Items"].append({
    "Id": "milo-api",
    "DomainName": EC2_DOMAIN,
    "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "https-only",
        "OriginSSLProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
    },
})
config["Origins"]["Quantity"] += 1

# Add /api/* cache behavior (insert before default)
api_behavior = {
    "PathPattern": "/api/*",
    "TargetOriginId": "milo-api",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
        "Quantity": 7,
        "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
        "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]},
    },
    "ForwardedValues": {
        "QueryString": True,
        "Cookies": {"Forward": "none"},
        "Headers": {"Quantity": 2, "Items": ["Host", "Authorization"]},
    },
    "MinTTL": 0,
    "DefaultTTL": 0,
    "MaxTTL": 0,
    "Compress": True,
    "TrustedSigners": {"Enabled": False, "Quantity": 0},
}
config["CacheBehaviors"]["Items"].insert(0, api_behavior)
config["CacheBehaviors"]["Quantity"] += 1

cf = boto3.client("cloudfront")
cf.update_distribution(
    Id="E1JA0JAUI27AQG",
    IfMatch=etag,
    DistributionConfig=config,
)
print("Distribution updated")
```

Replace `YOUR_EC2_PUBLIC_DNS_OR_IP` with the actual EC2 domain, then run:

```bash
AWS_PROFILE=unicorn python3 /tmp/patch-cf-api.py
```

- [ ] **Step 3: Wait for CloudFront to deploy (~5 min)**

```bash
AWS_PROFILE=unicorn aws cloudfront wait distribution-deployed --id E1JA0JAUI27AQG
```

- [ ] **Step 4: Verify**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://d1mdo4f666qe9e.cloudfront.net/api/forms/ab867633-9d48-4258-b752-07214d6314b7/test \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"email":"test@test.com","_hp":""}'
```

Expected: `201`

---

## Task 10: EC2 deployment (manual setup)

- [ ] **Step 1: Launch EC2 instance in us-east-1**

Via AWS console or CLI: t3.small, Amazon Linux 2023, public subnet, security group allowing 443 inbound from CloudFront prefix list (`pl-3b927c52`), SSH from your IP.

- [ ] **Step 2: Install Docker + docker-compose**

```bash
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
# Log out and back in, then:
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

- [ ] **Step 3: Clone repo + add `.env`**

```bash
git clone https://github.com/YOUR_ORG/websites.git
cd websites
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with production values including SES_FROM_EMAIL
```

- [ ] **Step 4: Start with docker-compose**

The existing `docker-compose.yml` (or create one) should run the monolith + Postgres + Redis. Start it:

```bash
docker-compose up -d
```

- [ ] **Step 5: Run migrations**

```bash
docker-compose exec api pnpm migrate
```

- [ ] **Step 6: Verify health**

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 7: SES domain verification (one-time)**

In AWS Console → SES → Verified Identities: add your sending domain, add DKIM records to DNS, request production access if in sandbox.

---

## Running all tests

After all code tasks are complete:

```bash
cd apps/api && pnpm test --no-file-parallelism
```

Expected: all tests pass including the two new test files.

```bash
cd apps/api && pnpm lint
```

Expected: no lint errors.
