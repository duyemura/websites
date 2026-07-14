import { describe, test, expect } from "vitest";
import { db } from "../../src/database";
import { getTestWorkspaceUuid } from "../helper";
import {
  createAssetGeneration,
  getAssetGeneration,
  updateAssetGenerationStatus,
  incrementAssetGenerationRetries,
} from "../../src/services/asset-generation";

describe("asset generation service", () => {
  async function makeInput(overrides?: { siteUuid?: string; subject?: string }) {
    return {
      workspaceUuid: await getTestWorkspaceUuid(),
      userUuid: "test-user",
      useCase: "hero" as const,
      subject: overrides?.subject ?? "Service test generation",
      referenceAssetUuids: [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ],
      outputSpec: { aspectRatio: "16:9", style: "cinematic" },
    };
  }

  test("createAssetGeneration inserts a pending row and returns uuid", async () => {
    const input = await makeInput();
    const { uuid } = await createAssetGeneration(db, input);

    const row = await getAssetGeneration(db, uuid);
    expect(row).toBeDefined();
    expect(row!.uuid).toBe(uuid);
    expect(row!.status).toBe("pending");
    expect(row!.useCase).toBe("hero");
    expect(row!.subject).toBe("Service test generation");
    expect(row!.referenceAssetUuids).toEqual(input.referenceAssetUuids);
    expect(row!.outputSpec).toEqual(input.outputSpec);
    expect(row!.retries).toBe(0);
  });

  test("getAssetGeneration returns undefined for unknown uuid", async () => {
    const row = await getAssetGeneration(
      db,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(row).toBeUndefined();
  });

  test("updateAssetGenerationStatus updates status and optional fields", async () => {
    const input = await makeInput();
    const { uuid } = await createAssetGeneration(db, input);
    // Ensure the update timestamp advances past the creation timestamp.
    await new Promise((r) => setTimeout(r, 5));

    await updateAssetGenerationStatus(db, uuid, "generating", {
      provider: "fal",
      providerJobId: "fal-job-1",
      promptSnapshot: { prompt: "test prompt" },
      metadata: { model: "fal-ai/flux/dev/image-to-image" },
    });

    const row = await getAssetGeneration(db, uuid);
    expect(row!.status).toBe("generating");
    expect(row!.provider).toBe("fal");
    expect(row!.providerJobId).toBe("fal-job-1");
    expect(row!.promptSnapshot).toEqual({ prompt: "test prompt" });
    expect(row!.metadata).toEqual({ model: "fal-ai/flux/dev/image-to-image" });
    expect(row!.updatedAt.getTime()).toBeGreaterThan(row!.createdAt.getTime());
  });

  test("incrementAssetGenerationRetries bumps retries", async () => {
    const input = await makeInput();
    const { uuid } = await createAssetGeneration(db, input);

    await incrementAssetGenerationRetries(db, uuid);
    await incrementAssetGenerationRetries(db, uuid);

    const row = await getAssetGeneration(db, uuid);
    expect(row!.retries).toBe(2);
  });
});
