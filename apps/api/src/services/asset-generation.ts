import type { Kysely } from "kysely";
import type { DB, AssetGenerationStatus } from "../types/db";
import type {
  AssetGenerationUseCase,
  OutputSpec,
} from "../ai/prompts/asset-generation";
import { jsonb } from "../utils/jsonb";

export interface CreateAssetGenerationInput {
  workspaceUuid: string;
  siteUuid?: string;
  userUuid: string;
  useCase: AssetGenerationUseCase;
  subject: string;
  referenceAssetUuids?: string[];
  outputSpec: OutputSpec;
}

export async function createAssetGeneration(
  db: Kysely<DB>,
  input: CreateAssetGenerationInput,
): Promise<{ uuid: string }> {
  const row = await db
    .insertInto("assetGenerations")
    .values({
      workspaceUuid: input.workspaceUuid,
      siteUuid: input.siteUuid ?? null,
      userUuid: input.userUuid,
      useCase: input.useCase,
      subject: input.subject,
      referenceAssetUuids: input.referenceAssetUuids
        ? jsonb(input.referenceAssetUuids)
        : null,
      outputSpec: jsonb(input.outputSpec),
      status: "pending",
      retries: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return { uuid: row.uuid };
}

export async function getAssetGeneration(
  db: Kysely<DB>,
  uuid: string,
): Promise<DB["assetGenerations"] | undefined> {
  const row = await db
    .selectFrom("assetGenerations")
    .selectAll()
    .where("uuid", "=", uuid)
    .executeTakeFirst();
  return row as DB["assetGenerations"] | undefined;
}

export interface AssetGenerationUpdate {
  siteUuid?: string | null;
  generatedAssetUuid?: string | null;
  provider?: string | null;
  providerJobId?: string | null;
  costUsd?: number | string | null;
  retries?: number;
  failureReason?: string | null;
  promptSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export async function updateAssetGenerationStatus(
  db: Kysely<DB>,
  uuid: string,
  status: AssetGenerationStatus,
  updates?: AssetGenerationUpdate,
): Promise<void> {
  const setValues: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (key === "promptSnapshot" || key === "metadata") {
        setValues[key] = value !== null ? jsonb(value) : null;
      } else {
        setValues[key] = value;
      }
    }
  }

  await db
    .updateTable("assetGenerations")
    .set(setValues)
    .where("uuid", "=", uuid)
    .execute();
}

export async function incrementAssetGenerationRetries(
  db: Kysely<DB>,
  uuid: string,
): Promise<void> {
  await db
    .updateTable("assetGenerations")
    .set((eb) => ({
      retries: eb("retries", "+", 1),
      updatedAt: new Date().toISOString(),
    }))
    .where("uuid", "=", uuid)
    .execute();
}

export async function retryAssetGeneration(
  db: Kysely<DB>,
  uuid: string,
): Promise<void> {
  await db
    .updateTable("assetGenerations")
    .set({
      status: "pending",
      failureReason: null,
      retries: 0,
      updatedAt: new Date().toISOString(),
    })
    .where("uuid", "=", uuid)
    .execute();
}

export async function deleteAssetGeneration(
  db: Kysely<DB>,
  uuid: string,
): Promise<void> {
  await db.deleteFrom("assetGenerations").where("uuid", "=", uuid).execute();
}
