import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DB } from "../types/db";
import { promoteDeploy } from "./mirror/deploy";

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
): Promise<{ version: number; deployPrefix: string }> {
  const row = await db.selectFrom("siteVersions")
    .select(["uuid", "version", "deployPrefix"])
    .where("siteUuid", "=", siteUuid)
    .where("version", "=", version)
    .executeTakeFirst();
  if (!row) throw new Error(`Version ${version} not found for site ${siteUuid}`);

  // Repoint current/: copy version prefix in, delete orphans (promoteDeploy does both).
  await promoteDeploy(s3Client, bucket, siteUuid, row.deployPrefix);

  await db.updateTable("siteVersions")
    .set({ publishedAt: new Date() })
    .where("uuid", "=", row.uuid)
    .execute();

  return { version: row.version, deployPrefix: row.deployPrefix };
}

export async function listSiteVersions(db: Kysely<DB>, siteUuid: string) {
  return db.selectFrom("siteVersions")
    .selectAll()
    .where("siteUuid", "=", siteUuid)
    .orderBy("version", "desc")
    .execute();
}
