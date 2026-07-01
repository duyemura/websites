import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "../../src/database";
import { selectReferenceAssets } from "../../src/utils/asset-reference-picker";
import { isAnalyzableImage } from "../../src/utils/asset-analysis";

describe("asset reference picker", () => {
  let workspaceUuid: string;

  beforeEach(async () => {
    const workspace = await db
      .insertInto("workspaces")
      .values({ name: "Reference Picker Test", slug: `ref-picker-${Date.now()}` })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    workspaceUuid = workspace.uuid;
  });

  afterEach(async () => {
    await db.deleteFrom("assets").where("workspaceUuid", "=", workspaceUuid).execute();
    await db.deleteFrom("workspaces").where("uuid", "=", workspaceUuid).execute();
  });

  function makeAsset(overrides?: {
    uuid?: string;
    type?: string;
    mimeType?: string;
    source?: string;
    analysis?: Record<string, unknown>;
  }) {
    return {
      workspaceUuid,
      name: "Test asset",
      type: overrides?.type ?? "image",
      source: overrides?.source ?? "upload",
      mimeType: overrides?.mimeType ?? "image/jpeg",
      url: "https://cdn.test/asset.jpg",
      storageKey: "workspaces/123/assets/test.jpg",
      metadata: overrides?.analysis ? { analysis: overrides.analysis } : null,
    };
  }

  test("returns empty result when no analyzed image assets exist", async () => {
    const result = await selectReferenceAssets({
      db,
      workspaceUuid,
      useCase: "hero",
    });

    expect(result.assets).toHaveLength(0);
    expect(result.warnings).toContain("No analyzed image assets found in this workspace.");
  });

  test("selects analyzed image assets and excludes screenshots", async () => {
    await db
      .insertInto("assets")
      .values([
        makeAsset({
          analysis: {
            description: "Wide gym floor",
            altText: "Gym floor",
            context: "hero",
            confidence: 0.9,
            tags: ["barbell"],
            technical: { hasText: false, textConfidence: 0, faces: null, people: 0 },
            quality: { score: 4, resolution: "high", sharpness: "good", issues: [] },
            marketing: { mood: "gritty", useCases: ["hero"], subject: "floor" },
            safety: { hasIdentifiablePeople: false, needsReview: false },
          },
        }),
        makeAsset({ source: "screenshot" }),
        makeAsset({ type: "document", mimeType: "application/pdf" }),
      ])
      .execute();

    const result = await selectReferenceAssets({
      db,
      workspaceUuid,
      useCase: "hero",
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.analysis.context).toBe("hero");
  });

  test("isAnalyzableImage includes image MIME types for logos and icons", () => {
    expect(isAnalyzableImage("logo", "image/svg+xml")).toBe(true);
    expect(isAnalyzableImage("icon", "image/png")).toBe(true);
    expect(isAnalyzableImage("document", "application/pdf")).toBe(false);
  });
});
