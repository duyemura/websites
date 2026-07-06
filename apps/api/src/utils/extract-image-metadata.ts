import sharp from "sharp";
import ExifReader from "exifreader";
import { sanitizeJsonValue } from "./sanitize-json";

export interface ExtractedImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  hasTransparency?: boolean;
  hasAnimation?: boolean;
  channels?: number;
  depth?: string;
  density?: number;
  orientation?: number;
  exif?: Record<string, unknown>;
  dominantColors?: string[];
  fileSize: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function extractDominantColors(stats: sharp.Stats): string[] {
  const dominant = (stats as { dominant?: Rgb }).dominant;
  if (dominant) {
    return [rgbToHex(dominant)];
  }
  return [];
}

async function parseExif(buffer: Buffer): Promise<Record<string, unknown> | undefined> {
  try {
    const tags = await ExifReader.load(buffer, { expanded: true });
    const picked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(tags)) {
      if (key === "Thumbnail" || key === "Images") continue;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const cleaned: Record<string, unknown> = {};
        for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
          if (innerKey === "value" && Array.isArray(innerValue)) {
            cleaned[innerKey] = (innerValue as { description: string }[]).map((v) =>
              typeof v === "object" && "description" in v ? v.description : v,
            );
          } else {
            cleaned[innerKey] = sanitizeJsonValue(innerValue);
          }
        }
        picked[key] = cleaned;
      } else {
        picked[key] = sanitizeJsonValue(value);
      }
    }
    return Object.keys(picked).length > 0 ? picked : undefined;
  } catch {
    return undefined;
  }
}

function isSvg(buffer: Buffer, mimeType?: string): boolean {
  if (mimeType === "image/svg+xml") return true;
  const head = buffer.slice(0, 200).toString("utf8").trim().toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<svg");
}

function parseSvgDimensions(buffer: Buffer): { width?: number; height?: number } {
  const text = buffer.toString("utf8");
  const viewBoxMatch = text.match(/viewBox=["']([^"']+)["']/);
  if (viewBoxMatch?.[1]) {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const widthMatch = text.match(/\bwidth=["']([0-9.]+)/);
  const heightMatch = text.match(/\bheight=["']([0-9.]+)/);
  return {
    width: widthMatch?.[1] ? Number.parseFloat(widthMatch[1]) : undefined,
    height: heightMatch?.[1] ? Number.parseFloat(heightMatch[1]) : undefined,
  };
}

export async function extractImageMetadata(
  buffer: Buffer,
  mimeType?: string,
): Promise<ExtractedImageMetadata> {
  if (isSvg(buffer, mimeType)) {
    return {
      ...parseSvgDimensions(buffer),
      format: "svg",
      hasTransparency: !buffer.toString("utf8").includes("background"),
      fileSize: buffer.length,
    };
  }

  const image = sharp(buffer, { failOnError: false });
  const metadata = await image.metadata();
  const stats = await image.stats();

  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasTransparency: metadata.hasAlpha,
    hasAnimation: metadata.pages ? metadata.pages > 1 : false,
    channels: metadata.channels,
    depth: metadata.depth,
    density: metadata.density,
    orientation: metadata.orientation,
    exif: await parseExif(buffer),
    dominantColors: extractDominantColors(stats),
    fileSize: buffer.length,
  };
}

const MAX_IMAGE_DIMENSION = 1024;
const JPEG_QUALITY = 85;

export async function prepareImageForVision(
  buffer: Buffer,
  mimeType?: string,
): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (isSvg(buffer, mimeType)) {
    return { buffer, mimeType: "image/svg+xml" };
  }

  const image = sharp(buffer, { failOnError: false });
  const metadata = await image.metadata();

  const needsResize =
    metadata.width &&
    metadata.height &&
    (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION);

  let processed = image;
  if (needsResize) {
    processed = image.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Preserve PNG only when transparency matters; otherwise use JPEG to keep
  // payloads small for vision models.
  const usePng = metadata.hasAlpha;
  if (usePng) {
    return { buffer: await processed.png({ quality: JPEG_QUALITY }).toBuffer(), mimeType: "image/png" };
  }
  return {
    buffer: await processed.jpeg({ quality: JPEG_QUALITY, progressive: true }).toBuffer(),
    mimeType: "image/jpeg",
  };
}

export function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
