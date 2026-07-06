# Staging / Production Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mirrored/template site gets two S3 prefixes (`staging/` and `production/`) and two subdomains on `mygymseo.com`, so all changes preview instantly on `-preview.mygymseo.com` and only go live on `.mygymseo.com` when explicitly published.

**Architecture:** Rename `current/` → `staging/` (preview, auto-updated on every deploy). Add `production/` (only updated by explicit `POST /sites/:uuid/publish`). CloudFront KVS maps `{uuid}-preview.mygymseo.com → staging` and `{uuid}.mygymseo.com → production`. Custom domains (when a gym cuts over DNS) always point to `production/`.

**Tech Stack:** TypeScript · Kysely · `@aws-sdk/client-s3` · `@aws-sdk/client-cloudfront-keyvaluestore` · Fastify

---

## Context for implementers

- `apps/api/src/services/mirror/deploy.ts` — `promoteDeploy()` currently copies to `sites/{uuid}/current/`
- `apps/api/src/services/site-versions.ts` — `publishSiteVersion()` currently calls `promoteDeploy()` → `current/`
- `apps/api/src/services/mirror/run-mirror.ts` — calls `promoteDeploy()` then `recordSiteVersion()`
- `apps/api/src/plugins/env.ts` — config schema (already has `CLOUDFRONT_KVS_ARN`)
- KVS ARN: `arn:aws:cloudfront::693244324682:key-value-store/1306140a-98fa-4501-a47a-aa4c3d4ac5ac`
- Torrance site UUID: `ab867633-9d48-4258-b752-07214d6314b7`
- Preview domain root: `mygymseo.com` (new env var `MILO_PREVIEW_DOMAIN`)

---

## File map

| File | Action | Purpose |
|---|---|---|
| `apps/api/src/services/mirror/deploy.ts` | **Modify** | `promoteDeploy` → writes to `staging/` not `current/`; new `publishToProduction` copies `staging/` → `production/` |
| `apps/api/src/services/site-versions.ts` | **Modify** | `publishSiteVersion` calls `publishToProduction`; mark version as published |
| `apps/api/src/services/mirror/run-mirror.ts` | **Modify** | After promote, auto-write KVS preview entry |
| `apps/api/src/plugins/env.ts` | **Modify** | Add `MILO_PREVIEW_DOMAIN` optional env var |
| `apps/api/src/api/routes/sites.ts` | **Modify** | Add `POST /sites/:uuid/publish` endpoint |
| `apps/api/src/worker/workers/go-live-site.ts` | **Modify** | KVS write → `production/` not `staging/` |

---

## Task 1: Rename `current/` → `staging/`, add `publishToProduction`

**Files:**
- Modify: `apps/api/src/services/mirror/deploy.ts`

- [ ] **Step 1: Read `apps/api/src/services/mirror/deploy.ts`**

Find `promoteDeploy` — it currently uses `const currentPrefix = \`sites/${siteUuid}/current\``.

- [ ] **Step 2: Rename `current/` → `staging/` in `promoteDeploy`**

Change line:
```typescript
const currentPrefix = `sites/${siteUuid}/current`;
```
To:
```typescript
const currentPrefix = `sites/${siteUuid}/staging`;
```

Nothing else changes in `promoteDeploy` — it still does the same copy + orphan-delete logic, just to `staging/` now.

- [ ] **Step 3: Add `publishToProduction` function at the end of `deploy.ts`**

```typescript
/**
 * Copy staging/ → production/ so the published version goes live.
 * Same copy+orphan-delete pattern as promoteDeploy.
 */
export async function publishToProduction(
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
): Promise<void> {
  const stagingPrefix = `sites/${siteUuid}/staging`;
  const productionPrefix = `sites/${siteUuid}/production`;

  // Collect all objects in staging
  const stagingPaths = new Set<string>();
  for (let tok: string | undefined = undefined; ;) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${stagingPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (obj.Key) stagingPaths.add(obj.Key.slice(stagingPrefix.length + 1));
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }

  // Delete objects in production/ absent from staging (stale cleanup)
  for (let tok: string | undefined = undefined; ;) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${productionPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(productionPrefix.length + 1);
      if (!stagingPaths.has(rel)) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      }
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }

  // Copy staging → production
  for (let tok: string | undefined = undefined; ;) {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${stagingPrefix}/`, ContinuationToken: tok }),
    );
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(stagingPrefix.length + 1);
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${obj.Key}`,
          Key: `${productionPrefix}/${rel}`,
        }),
      );
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }
}
```

`ListObjectsV2CommandOutput`, `ListObjectsV2Command`, `CopyObjectCommand`, `DeleteObjectCommand` are already imported at the top of the file.

- [ ] **Step 4: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/mirror/deploy.ts
git commit -m "feat(hosting): promoteDeploy writes to staging/, add publishToProduction"
```

---

## Task 2: Update `publishSiteVersion`, add env var, add `POST /publish` endpoint

**Files:**
- Modify: `apps/api/src/services/site-versions.ts`
- Modify: `apps/api/src/plugins/env.ts`
- Modify: `apps/api/src/api/routes/sites.ts`

- [ ] **Step 1: Update `publishSiteVersion` in `site-versions.ts`**

Read the file. Change `publishSiteVersion` to call `publishToProduction` instead of `promoteDeploy`. The function no longer needs a `version` parameter — it publishes whatever is currently in `staging/` and marks the latest version as published:

```typescript
import { promoteDeploy, publishToProduction } from "./mirror/deploy";

export async function publishSiteVersion(
  db: Kysely<DB>,
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
  version: number,
): Promise<{ version: number; deployPrefix: string }> {
  const row = await db.selectFrom("siteVersions")
    .select(["uuid", "version", "deployPrefix"])
    .where("siteUuid", "=", siteUuid)
    .where("version", "=", version)
    .executeTakeFirst();
  if (!row) throw new Error(`Version ${version} not found for site ${siteUuid}`);

  // Copy staging → production
  await publishToProduction(s3Client, bucket, siteUuid);

  await db.updateTable("siteVersions")
    .set({ publishedAt: new Date() })
    .where("uuid", "=", row.uuid)
    .execute();

  return { version: row.version, deployPrefix: row.deployPrefix };
}
```

Also add a simpler helper for the publish endpoint:

```typescript
export async function publishLatestStagingToProduction(
  db: Kysely<DB>,
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
): Promise<{ version: number }> {
  // Find the latest version for this site
  const latest = await db.selectFrom("siteVersions")
    .select(["uuid", "version"])
    .where("siteUuid", "=", siteUuid)
    .orderBy("version", "desc")
    .executeTakeFirst();

  await publishToProduction(s3Client, bucket, siteUuid);

  if (latest) {
    await db.updateTable("siteVersions")
      .set({ publishedAt: new Date() })
      .where("uuid", "=", latest.uuid)
      .execute();
    return { version: latest.version };
  }
  return { version: 0 };
}
```

- [ ] **Step 2: Add `MILO_PREVIEW_DOMAIN` to env config**

In `apps/api/src/plugins/env.ts`, add after `CLOUDFRONT_KVS_ARN`:

```typescript
/** Domain for auto-generated preview subdomains, e.g. "mygymseo.com" → {uuid}-preview.mygymseo.com */
MILO_PREVIEW_DOMAIN: z.string().optional(),
```

- [ ] **Step 3: Add `POST /sites/:uuid/publish` endpoint**

In `apps/api/src/api/routes/sites.ts`, find the notify-email endpoint (near bottom of mutation endpoints) and add after it:

```typescript
fastify.post(
  "/sites/:uuid/publish",
  {
    schema: {
      params: z.object({ uuid: z.string().uuid() }),
      response: {
        200: z.object({ ok: z.literal(true), version: z.number() }),
        404: z.object({ error: z.string() }),
      },
    },
  },
  async (request, reply) => {
    const siteUuid = request.params.uuid;
    const workspaceUuid = request.workspace.uuid;

    const site = await fastify.db
      .selectFrom("sites")
      .select("uuid")
      .where("uuid", "=", siteUuid)
      .where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
    if (!site) return reply.code(404).send({ error: "Site not found" });

    const { publishLatestStagingToProduction } = await import("../../services/site-versions.js");
    const bucket = fastify.config.S3_DEPLOYMENTS_BUCKET ?? fastify.config.S3_ASSETS_BUCKET;
    const s3Client = (await import("../../s3.js")).getS3Client({
      endpoint: fastify.config.S3_ENDPOINT,
      region: fastify.config.S3_REGION,
      accessKeyId: fastify.config.S3_ACCESS_KEY,
      secretAccessKey: fastify.config.S3_SECRET_KEY,
    });

    const result = await publishLatestStagingToProduction(fastify.db, s3Client, bucket, siteUuid);
    return reply.code(200).send({ ok: true, version: result.version });
  },
);
```

- [ ] **Step 4: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/site-versions.ts apps/api/src/plugins/env.ts apps/api/src/api/routes/sites.ts
git commit -m "feat(hosting): publish endpoint, publishLatestStagingToProduction, MILO_PREVIEW_DOMAIN env"
```

---

## Task 3: Auto-write KVS preview entry after mirror + update go-live

**Files:**
- Modify: `apps/api/src/services/mirror/run-mirror.ts`
- Modify: `apps/api/src/worker/workers/go-live-site.ts`

- [ ] **Step 1: Add KVS write to `run-mirror.ts`**

Read `apps/api/src/services/mirror/run-mirror.ts`. After the `promoteDeploy` call (which now writes to `staging/`), add a KVS write for the preview subdomain:

```typescript
// Auto-write preview subdomain: {uuid}-preview.{MILO_PREVIEW_DOMAIN} → sites/{uuid}/staging
// Non-fatal: KVS failure does not fail the mirror.
const previewDomain = config.MILO_PREVIEW_DOMAIN;
const kvsArn = config.CLOUDFRONT_KVS_ARN;
if (previewDomain && kvsArn) {
  try {
    const { CloudFrontKeyValueStoreClient, PutKeyCommand, DescribeKeyValueStoreCommand } =
      await import("@aws-sdk/client-cloudfront-keyvaluestore");
    const kvsClient = new CloudFrontKeyValueStoreClient({});
    const desc = await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));
    await kvsClient.send(new PutKeyCommand({
      KvsARN: kvsArn,
      IfMatch: desc.ETag,
      Key: `${siteUuid}-preview.${previewDomain}`,
      Value: `sites/${siteUuid}/staging`,
    }));
    log.info({ siteUuid, previewSubdomain: `${siteUuid}-preview.${previewDomain}` }, "preview subdomain KVS written");
  } catch (kvsErr) {
    log.warn({ siteUuid, err: kvsErr }, "preview KVS write failed — subdomain must be set manually");
  }
}
```

Place this block after `await promoteDeploy(s3Client, bucket, siteUuid, deploy.deployPrefix);` and before `recordSiteVersion`.

- [ ] **Step 2: Update go-live worker to point custom domain → `production/`**

Read `apps/api/src/worker/workers/go-live-site.ts`. Find the KVS write block added previously. It currently writes:
```typescript
Value: `sites/${siteUuid}/current`,
```
Change to:
```typescript
Value: `sites/${siteUuid}/production`,
```

Also update the comment from `KVS routing written` to `custom domain KVS → production written`.

- [ ] **Step 3: Add `MILO_PREVIEW_DOMAIN` to local `.env`**

```bash
echo "MILO_PREVIEW_DOMAIN=mygymseo.com" >> apps/api/.env
```

- [ ] **Step 4: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/mirror/run-mirror.ts apps/api/src/worker/workers/go-live-site.ts apps/api/.env
git commit -m "feat(hosting): auto-write preview KVS on mirror, go-live → production/"
```

---

## Task 4: Migrate Torrance + wire up KVS entries

This task migrates the existing Torrance site from `current/` to `staging/` + `production/`, and adds the new KVS entries.

**Files:**
- Create: `apps/api/scripts/migrate-to-staging-production.ts` (one-shot migration script, delete after use)

- [ ] **Step 1: Create migration script**

```typescript
// apps/api/scripts/migrate-to-staging-production.ts
// One-shot migration: copy Torrance current/ → staging/ and production/
// Run once, then delete this file.
import "dotenv/config";
import { configDotenv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
configDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"), override: false });

import { getS3Client } from "../src/s3";
import { config } from "../src/database";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { CloudFrontKeyValueStoreClient, PutKeyCommand, DescribeKeyValueStoreCommand } from "@aws-sdk/client-cloudfront-keyvaluestore";

const SITE_UUID = "ab867633-9d48-4258-b752-07214d6314b7";
const KVS_ARN = "arn:aws:cloudfront::693244324682:key-value-store/1306140a-98fa-4501-a47a-aa4c3d4ac5ac";
const PREVIEW_DOMAIN = "mygymseo.com";

async function copyPrefix(s3: S3Client, bucket: string, from: string, to: string) {
  let count = 0;
  for (let tok: string | undefined = undefined; ;) {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${from}/`, ContinuationToken: tok }));
    for (const obj of listed.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(from.length + 1);
      await s3.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${obj.Key}`, Key: `${to}/${rel}` }));
      count++;
    }
    if (!listed.IsTruncated) break;
    tok = listed.NextContinuationToken;
  }
  return count;
}

async function main() {
  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  const s3 = getS3Client({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY });

  const from = `sites/${SITE_UUID}/current`;
  const staging = `sites/${SITE_UUID}/staging`;
  const production = `sites/${SITE_UUID}/production`;

  console.log("Copying current/ → staging/...");
  const n1 = await copyPrefix(s3, bucket, from, staging);
  console.log(`  ${n1} objects copied`);

  console.log("Copying current/ → production/...");
  const n2 = await copyPrefix(s3, bucket, from, production);
  console.log(`  ${n2} objects copied`);

  // Update KVS
  const kvsClient = new CloudFrontKeyValueStoreClient({});
  const desc = await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: KVS_ARN }));

  console.log("Writing KVS entries...");
  // Main subdomain → production
  await kvsClient.send(new PutKeyCommand({ KvsARN: KVS_ARN, IfMatch: desc.ETag, Key: `${SITE_UUID}.${PREVIEW_DOMAIN}`, Value: production }));

  // Refresh ETag for second write
  const desc2 = await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: KVS_ARN }));
  // Preview subdomain → staging
  await kvsClient.send(new PutKeyCommand({ KvsARN: KVS_ARN, IfMatch: desc2.ETag, Key: `${SITE_UUID}-preview.${PREVIEW_DOMAIN}`, Value: staging }));

  console.log(`✅ Done`);
  console.log(`  Preview: https://${SITE_UUID}-preview.${PREVIEW_DOMAIN}/`);
  console.log(`  Production: https://${SITE_UUID}.${PREVIEW_DOMAIN}/`);
}

main().catch(console.error);
```

- [ ] **Step 2: Run the migration**

```bash
cd apps/api && pnpm exec tsx scripts/migrate-to-staging-production.ts
```

Expected output:
```
Copying current/ → staging/...
  ~800 objects copied
Copying current/ → production/...
  ~800 objects copied
Writing KVS entries...
✅ Done
  Preview: https://ab867633-preview.mygymseo.com/
  Production: https://ab867633.mygymseo.com/
```

- [ ] **Step 3: Verify both URLs work**

- `https://ab867633.mygymseo.com/` → Torrance site (production)
- `https://ab867633-preview.mygymseo.com/` → Torrance site (staging — identical for now)

- [ ] **Step 4: Delete migration script**

```bash
rm apps/api/scripts/migrate-to-staging-production.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(hosting): migrate Torrance to staging/production, add KVS entries"
git push origin main
```

---

## Summary

After all 4 tasks:

| URL | What it serves |
|---|---|
| `ab867633.mygymseo.com` | Production — explicitly published |
| `ab867633-preview.mygymseo.com` | Staging — auto-updated on every mirror/deploy |
| `torrancetraininglab.com` (when DNS pointed) | Production |

**Publish flow:**
```bash
# Everything auto-deploys to staging on mirror/template rebuild
# To go live:
curl -X POST https://d1mdo4f666qe9e.cloudfront.net/api/sites/ab867633.../publish \
  -H "Authorization: Bearer ..." -H "x-workspace-slug: ..."
```

**Or via milo CLI (future):**
```bash
pnpm milo --site ab867633... --stages publish
```
