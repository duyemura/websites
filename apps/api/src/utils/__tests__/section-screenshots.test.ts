import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { cropSectionScreenshots } from "../section-screenshots";
import type { SectionVisualEvidenceRow } from "../../types/section-visual-evidence";

function makeRow(
  overrides?: Partial<SectionVisualEvidenceRow>,
): SectionVisualEvidenceRow {
  return {
    evidenceId: "evidence-1",
    pageSlug: "home",
    sectionId: "hero",
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    computedStyles: [],
    ...overrides,
  };
}

describe("cropSectionScreenshots", () => {
  let tempDir: string;
  let imagePath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "section-screenshots-"));
    imagePath = join(tempDir, "full-page.png");
    const buffer = await sharp({
      create: {
        width: 100,
        height: 200,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(imagePath, buffer);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("clamps crop dimensions to image bounds and returns a valid PNG", async () => {
    const rows: SectionVisualEvidenceRow[] = [
      makeRow({
        evidenceId: "evidence-clamped",
        boundingBox: { x: 50, y: 150, width: 100, height: 100 },
      }),
    ];

    const result = await cropSectionScreenshots(imagePath, rows);

    expect(result).toHaveLength(1);
    const cropped = result[0];
    if (!cropped) {
      throw new Error("expected a cropped screenshot");
    }
    expect(cropped.evidenceId).toBe("evidence-clamped");

    const metadata = await sharp(cropped.buffer).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(50);
    expect(metadata.height).toBe(50);
  });

  test("skips rows that are entirely outside image bounds", async () => {
    const rows: SectionVisualEvidenceRow[] = [
      makeRow({
        evidenceId: "evidence-off-screen",
        boundingBox: { x: 100, y: 200, width: 50, height: 50 },
      }),
    ];

    const result = await cropSectionScreenshots(imagePath, rows);

    expect(result).toHaveLength(0);
  });
});
