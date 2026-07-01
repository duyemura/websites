import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { VisualBrandMemory } from "../ai/prompts/asset-generation";
import { jsonb } from "../utils/jsonb";

export interface WorkspaceBrandMemoryInput {
  businessName?: string;
  businessArchetype?: string;
  mood?: string;
  lighting?: string;
  colorPalette?: { hex: string; role?: string }[];
  interiorAndFinishes?: string;
  equipmentTags?: string[];
  signageNotes?: string;
  imageryStrategy?: string;
  promptKeywords?: string[];
  differentiators?: string[];
  richContext?: Record<string, unknown>;
}

function inferArchetype(workspaceName: string, businessName?: string): string {
  const corpus = `${businessName ?? ""} ${workspaceName}`.toLowerCase();
  if (corpus.includes("crossfit")) return "CrossFit box";
  if (corpus.includes("yoga")) return "yoga studio";
  if (corpus.includes("pilates")) return "Pilates studio";
  if (corpus.includes("jiu") || corpus.includes("bjj")) return "Brazilian jiu-jitsu academy";
  if (corpus.includes("muay") || corpus.includes("kickbox")) return "striking gym";
  if (corpus.includes("powerlift")) return "powerlifting gym";
  if (corpus.includes("olympic")) return "Olympic weightlifting club";
  if (corpus.includes("personal") || corpus.includes("pt")) return "personal training studio";
  return "fitness studio";
}

export async function getWorkspaceBrandMemory(
  db: Kysely<DB>,
  workspaceUuid: string,
): Promise<WorkspaceBrandMemoryInput | null> {
  const row = await db
    .selectFrom("workspaceBrandMemory")
    .selectAll()
    .where("workspaceUuid", "=", workspaceUuid)
    .executeTakeFirst();
  if (!row) return null;
  return {
    businessName: row.businessName ?? undefined,
    businessArchetype: row.businessArchetype ?? undefined,
    mood: row.mood ?? undefined,
    lighting: row.lighting ?? undefined,
    colorPalette: (row.colorPalette as { hex: string; role?: string }[] | null) ?? undefined,
    interiorAndFinishes: row.interiorAndFinishes ?? undefined,
    equipmentTags: (row.equipmentTags as string[] | null) ?? undefined,
    signageNotes: row.signageNotes ?? undefined,
    imageryStrategy: row.imageryStrategy ?? undefined,
    promptKeywords: (row.promptKeywords as string[] | null) ?? undefined,
    differentiators: (row.differentiators as string[] | null) ?? undefined,
    richContext: (row.richContext as Record<string, unknown> | null) ?? undefined,
  };
}

export async function upsertWorkspaceBrandMemory(
  db: Kysely<DB>,
  workspaceUuid: string,
  input: WorkspaceBrandMemoryInput,
): Promise<void> {
  const values = {
    workspaceUuid,
    businessName: input.businessName ?? null,
    businessArchetype: input.businessArchetype ?? null,
    mood: input.mood ?? null,
    lighting: input.lighting ?? null,
    colorPalette: input.colorPalette ? jsonb(input.colorPalette) : null,
    interiorAndFinishes: input.interiorAndFinishes ?? null,
    equipmentTags: input.equipmentTags ? jsonb(input.equipmentTags) : null,
    signageNotes: input.signageNotes ?? null,
    imageryStrategy: input.imageryStrategy ?? null,
    promptKeywords: input.promptKeywords ? jsonb(input.promptKeywords) : null,
    differentiators: input.differentiators ? jsonb(input.differentiators) : null,
    richContext: input.richContext ? jsonb(input.richContext) : null,
    updatedAt: new Date().toISOString(),
  };

  await db
    .insertInto("workspaceBrandMemory")
    .values({
      ...values,
      createdAt: new Date().toISOString(),
    })
    .onConflict((oc) => oc.column("workspaceUuid").doUpdateSet(values))
    .execute();
}

export async function buildVisualBrandMemory(
  db: Kysely<DB>,
  workspaceUuid: string,
): Promise<VisualBrandMemory> {
  const [workspace, memory] = await Promise.all([
    db
      .selectFrom("workspaces")
      .select(["name", "brandPrimaryColor"])
      .where("uuid", "=", workspaceUuid)
      .executeTakeFirst(),
    getWorkspaceBrandMemory(db, workspaceUuid),
  ]);

  const businessName = memory?.businessName ?? workspace?.name ?? "";
  const archetype =
    memory?.businessArchetype ?? inferArchetype(workspace?.name ?? "", memory?.businessName);
  const mood = memory?.mood ?? "professional, motivating";

  const palette = memory?.colorPalette?.length
    ? memory.colorPalette
    : workspace?.brandPrimaryColor
      ? [{ hex: workspace.brandPrimaryColor, role: "primary" }]
      : [{ hex: "#333333", role: "neutral" }];

  return {
    businessName,
    businessArchetype: archetype,
    mood,
    lighting: memory?.lighting,
    colorPalette: palette,
    interiorAndFinishes: memory?.interiorAndFinishes,
    equipmentTags: memory?.equipmentTags ?? [],
    signageNotes: memory?.signageNotes,
    imageryStrategy: memory?.imageryStrategy,
    promptKeywords: memory?.promptKeywords ?? [],
    differentiators: memory?.differentiators ?? [],
  };
}
