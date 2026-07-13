import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DB } from "../types/db";
import { publishToProduction } from "./mirror/deploy";

async function invalidateCloudFront(distributionId: string | undefined): Promise<string | null> {
  if (!distributionId) return null;
  try {
    const { CloudFrontClient, CreateInvalidationCommand, GetInvalidationCommand } = await import("@aws-sdk/client-cloudfront");
    const cf = new CloudFrontClient({});
    const created = await cf.send(new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `publish-${Date.now()}`,
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    }));
    const invalidationId = created.Invalidation?.Id ?? null;
    if (!invalidationId) return null;

    // Poll until the invalidation completes so downstream eval tests fresh content.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const check = await cf.send(new GetInvalidationCommand({
        DistributionId: distributionId,
        Id: invalidationId,
      }));
      if (check.Invalidation?.Status === "Completed") return invalidationId;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return invalidationId; // return id even if not completed within timeout
  } catch {
    // Non-fatal — cache will expire naturally
    return null;
  }
}

async function registerDefaultRouting(
  siteUuid: string,
  kvsArn: string | undefined,
  previewDomain: string | undefined,
): Promise<void> {
  if (!kvsArn || !previewDomain) return;
  try {
    const { CloudFrontKeyValueStoreClient, PutKeyCommand, DescribeKeyValueStoreCommand } =
      await import("@aws-sdk/client-cloudfront-keyvaluestore");
    const kvsClient = new CloudFrontKeyValueStoreClient({});
    const shortId = siteUuid.slice(0, 8);
    const prodHost = `${shortId}.${previewDomain}`;
    const previewHost = `${shortId}-preview.${previewDomain}`;

    const describe = async () =>
      await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));

    let desc = await describe();
    await kvsClient.send(new PutKeyCommand({
      KvsARN: kvsArn,
      IfMatch: desc.ETag,
      Key: prodHost,
      Value: `sites/${siteUuid}/production`,
    }));

    desc = await describe();
    await kvsClient.send(new PutKeyCommand({
      KvsARN: kvsArn,
      IfMatch: desc.ETag,
      Key: previewHost,
      Value: `sites/${siteUuid}/staging`,
    }));
  } catch {
    // Non-fatal — routing can be configured manually if KVS write fails
  }
}

export interface RecordVersionInput {
  siteUuid: string;
  workspaceUuid: string;
  kind: "mirror" | "template";
  deployPrefix: string;
  label?: string;
}

export async function recordSiteVersion(db: Kysely<DB>, input: RecordVersionInput) {
  return db.insertInto("siteVersions")
    .values({
      siteUuid: input.siteUuid,
      workspaceUuid: input.workspaceUuid,
      // Atomic next-version (same pattern as transforms ordinal)
      version: sql<number>`(select coalesce(max(version), 0) + 1 from site_versions where site_uuid = ${input.siteUuid})`,
      kind: input.kind,
      deployPrefix: input.deployPrefix,
      label: input.label ?? null,
    })
    .returning(["uuid", "version", "deployPrefix"])
    .executeTakeFirstOrThrow();
}

export async function publishSiteVersion(
  db: Kysely<DB>,
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
  version: number,
  distributionId?: string,
  kvsArn?: string,
  previewDomain?: string,
): Promise<{ version: number; deployPrefix: string }> {
  const row = await db.selectFrom("siteVersions")
    .select(["uuid", "version", "deployPrefix"])
    .where("siteUuid", "=", siteUuid)
    .where("version", "=", version)
    .executeTakeFirst();
  if (!row) throw new Error(`Version ${version} not found for site ${siteUuid}`);

  // Copy staging → production
  await publishToProduction(s3Client, bucket, siteUuid);
  await Promise.all([
    invalidateCloudFront(distributionId),
    registerDefaultRouting(siteUuid, kvsArn, previewDomain),
  ]);

  await db.updateTable("siteVersions")
    .set({ publishedAt: new Date() })
    .where("uuid", "=", row.uuid)
    .execute();

  await db.updateTable("sites")
    .set({ status: "published" })
    .where("uuid", "=", siteUuid)
    .execute();

  return { version: row.version, deployPrefix: row.deployPrefix };
}

export async function publishLatestStagingToProduction(
  db: Kysely<DB>,
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
  distributionId?: string,
  kvsArn?: string,
  previewDomain?: string,
): Promise<{ version: number }> {
  const latest = await db.selectFrom("siteVersions")
    .select(["uuid", "version"])
    .where("siteUuid", "=", siteUuid)
    .orderBy("version", "desc")
    .executeTakeFirst();

  await publishToProduction(s3Client, bucket, siteUuid);
  await Promise.all([
    invalidateCloudFront(distributionId),
    registerDefaultRouting(siteUuid, kvsArn, previewDomain),
  ]);

  if (latest) {
    await db.updateTable("siteVersions")
      .set({ publishedAt: new Date() })
      .where("uuid", "=", latest.uuid)
      .execute();
    await db.updateTable("sites")
      .set({ status: "published" })
      .where("uuid", "=", siteUuid)
      .execute();
    return { version: latest.version };
  }
  return { version: 0 };
}

export async function listSiteVersions(db: Kysely<DB>, siteUuid: string) {
  return db.selectFrom("siteVersions")
    .selectAll()
    .where("siteUuid", "=", siteUuid)
    .orderBy("version", "desc")
    .execute();
}
