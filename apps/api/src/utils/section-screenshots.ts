import { readFile } from "fs/promises";
import type { SectionVisualEvidenceRow } from "../types/section-visual-evidence";

export interface CroppedSectionScreenshot {
  evidenceId: string;
  buffer: Buffer;
  metadata: {
    filename: string;
    description: string;
    tags: string[];
  };
}

export async function cropSectionScreenshots(
  fullPageScreenshotPath: string,
  rows: SectionVisualEvidenceRow[],
): Promise<CroppedSectionScreenshot[]> {
  const fullBuffer = await readFile(fullPageScreenshotPath);
  const sharp = await import("sharp");
  const { width: imageWidth, height: imageHeight } = await sharp.default(fullBuffer).metadata();
  if (!imageWidth || !imageHeight) {
    throw new Error("Unable to read full-page screenshot dimensions");
  }

  const results: CroppedSectionScreenshot[] = [];

  for (const row of rows) {
    const { x, y, width, height } = row.boundingBox;
    if (width <= 0 || height <= 0) continue;

    const safeLeft = Math.max(0, Math.round(x));
    const safeTop = Math.max(0, Math.round(y));
    const maxWidth = imageWidth - safeLeft;
    const maxHeight = imageHeight - safeTop;
    const cropWidth = Math.min(Math.round(width), maxWidth);
    const cropHeight = Math.min(Math.round(height), maxHeight);

    if (cropWidth <= 0 || cropHeight <= 0) continue;

    const cropped = await sharp
      .default(fullBuffer)
      .extract({ left: safeLeft, top: safeTop, width: cropWidth, height: cropHeight })
      .png()
      .toBuffer();

    results.push({
      evidenceId: row.evidenceId,
      buffer: cropped,
      metadata: {
        filename: `${row.evidenceId}.png`,
        description: `Cropped screenshot of section ${row.sectionId} on page ${row.pageSlug}`,
        tags: ["section-screenshot", row.pageSlug, row.sectionId],
      },
    });
  }

  return results;
}
