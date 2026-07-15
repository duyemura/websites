import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  CreateInvalidationCommand,
  GetInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  CloudFrontKeyValueStoreClient,
  PutKeyCommand,
  DescribeKeyValueStoreCommand,
} from "@aws-sdk/client-cloudfront-keyvaluestore";
import type { DB } from "../types/db";
import { publishToProduction } from "./mirror/deploy";
import {
  cloudFrontClientInputFromConfig,
  getCloudFrontClient,
  type CloudFrontConfig,
} from "./mirror/cloudfront";

async function invalidateCloudFront(
  distributionId: string | undefined,
  config: CloudFrontConfig,
): Promise<string | null> {
  if (!distributionId) return null;
  const cfInput = cloudFrontClientInputFromConfig(config);
  try {
    const cf = await getCloudFrontClient(cfInput);
    const created = await cf.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `publish-${Date.now()}`,
          Paths: { Quantity: 1, Items: ["/*"] },
        },
      }),
    );
    const invalidationId = created.Invalidation?.Id ?? null;
    if (!invalidationId) return null;

    // Poll until the invalidation completes so downstream eval tests fresh content.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const check = await cf.send(
        new GetInvalidationCommand({
          DistributionId: distributionId,
          Id: invalidationId,
        }),
      );
      if (check.Invalidation?.Status === "Completed") return invalidationId;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return invalidationId; // return id even if not completed within timeout
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[cloudfront] production invalidation failed: ${message}`);
    return null;
  }
}

async function registerDefaultRouting(
  siteUuid: string,
  kvsArn: string | undefined,
  previewDomain: string | undefined,
  config: CloudFrontConfig,
): Promise<void> {
  if (!kvsArn || !previewDomain) return;
  try {
    const cfInput = cloudFrontClientInputFromConfig(config);
    const credentials = await getCloudFrontClient(cfInput).then((c) => c.config.credentials());
    const kvsClient = new CloudFrontKeyValueStoreClient({
      region: cfInput.region ?? "us-east-1",
      credentials,
    });
    const shortId = siteUuid.slice(0, 8);
    const prodHost = `${shortId}.${previewDomain}`;
    const previewHost = `${shortId}-preview.${previewDomain}`;

    const describe = async () =>
      await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));

    let desc = await describe();
    await kvsClient.send(
      new PutKeyCommand({
        KvsARN: kvsArn,
        IfMatch: desc.ETag,
        Key: prodHost,
        Value: `sites/${siteUuid}/production`,
      }),
    );

    desc = await describe();
    await kvsClient.send(
      new PutKeyCommand({
        KvsARN: kvsArn,
        IfMatch: desc.ETag,
        Key: previewHost,
        Value: `sites/${siteUuid}/staging`,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[cloudfront] default routing update failed: ${message}`);
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
  config?: CloudFrontConfig,
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
    invalidateCloudFront(distributionId, config ?? { S3_REGION: "us-east-1", CLOUDFRONT_PROFILE: "unicorn" }),
    registerDefaultRouting(siteUuid, kvsArn, previewDomain, config ?? { S3_REGION: "us-east-1", CLOUDFRONT_PROFILE: "unicorn" }),
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
  config?: CloudFrontConfig,
): Promise<{ version: number }> {
  const latest = await db.selectFrom("siteVersions")
    .select(["uuid", "version"])
    .where("siteUuid", "=", siteUuid)
    .orderBy("version", "desc")
    .executeTakeFirst();

  await publishToProduction(s3Client, bucket, siteUuid);
  await Promise.all([
    invalidateCloudFront(distributionId, config ?? { S3_REGION: "us-east-1", CLOUDFRONT_PROFILE: "unicorn" }),
    registerDefaultRouting(siteUuid, kvsArn, previewDomain, config ?? { S3_REGION: "us-east-1", CLOUDFRONT_PROFILE: "unicorn" }),
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
