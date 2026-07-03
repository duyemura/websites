import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { PipelineStage } from "../../types/pipeline-artifacts";
import { jsonb } from "../jsonb";

export interface ArtifactContext {
  siteUuid: string;
  workspaceUuid: string;
}

export interface StoredArtifact<T = unknown> {
  version: number;
  payload: T;
  createdAt: Date;
}

const KEEP_VERSIONS = 3;

export async function saveArtifact(
  db: Kysely<DB>,
  ctx: ArtifactContext,
  stage: PipelineStage,
  payload: unknown,
): Promise<number> {
  const latest = await db
    .selectFrom("pipelineArtifacts")
    .select("version")
    .where("siteUuid", "=", ctx.siteUuid)
    .where("stage", "=", stage)
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();

  const version = (latest?.version ?? 0) + 1;
  await db
    .insertInto("pipelineArtifacts")
    .values({
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      stage,
      version,
      payload: jsonb(payload),
    })
    .execute();

  await db
    .deleteFrom("pipelineArtifacts")
    .where("siteUuid", "=", ctx.siteUuid)
    .where("stage", "=", stage)
    .where("version", "<=", version - KEEP_VERSIONS)
    .execute();

  return version;
}

export async function loadArtifact<T = unknown>(
  db: Kysely<DB>,
  ctx: ArtifactContext,
  stage: PipelineStage,
): Promise<StoredArtifact<T> | null> {
  const row = await db
    .selectFrom("pipelineArtifacts")
    .select(["version", "payload", "createdAt"])
    .where("siteUuid", "=", ctx.siteUuid)
    .where("stage", "=", stage)
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    version: row.version,
    payload: row.payload as T,
    createdAt: row.createdAt,
  };
}

export async function loadArtifactVersion<T = unknown>(
  db: Kysely<DB>,
  ctx: ArtifactContext,
  stage: PipelineStage,
  version: number,
): Promise<StoredArtifact<T> | null> {
  const row = await db
    .selectFrom("pipelineArtifacts")
    .select(["version", "payload", "createdAt"])
    .where("siteUuid", "=", ctx.siteUuid)
    .where("stage", "=", stage)
    .where("version", "=", version)
    .executeTakeFirst();
  if (!row) return null;
  return {
    version: row.version,
    payload: row.payload as T,
    createdAt: row.createdAt,
  };
}
