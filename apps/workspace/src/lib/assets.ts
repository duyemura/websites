import type { Asset, AssetAnalysis, AssetMetadata } from "@/lib/api";

export function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = sizes[Math.min(i, sizes.length - 1)];
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${size}`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const ASSET_TAGS = [
  { key: "user-uploaded", label: "User uploaded", icon: "upload" as const },
  { key: "ai-generated", label: "AI generated", icon: "sparkles" as const },
  { key: "figma", label: "Figma", icon: "figma" as const },
  { key: "website", label: "Website", icon: "globe" as const },
  { key: "screenshot", label: "Screenshots", icon: "camera" as const },
  { key: "ad-creative", label: "Ad creatives", icon: "megaphone" as const },
  { key: "graphic", label: "Graphics", icon: "shapes" as const },
  { key: "logo", label: "Logos", icon: "hexagon" as const },
  { key: "product-image", label: "Product images", icon: "package" as const },
  { key: "photograph", label: "Photographs", icon: "image" as const },
  { key: "font", label: "Fonts", icon: "type" as const },
] as const;

export type AssetTagKey = (typeof ASSET_TAGS)[number]["key"];

const TYPE_TAG_MAP: Record<Asset["type"], AssetTagKey> = {
  image: "photograph",
  video: "screenshot",
  font: "font",
  document: "website",
  logo: "logo",
  icon: "graphic",
};

function isAssetTagKey(tag: string): tag is AssetTagKey {
  return ASSET_TAGS.some((t) => t.key === tag);
}

export function getAssetSourceLabel(source: Asset["source"]): string {
  switch (source) {
    case "upload":
      return "Upload";
    case "scraped":
      return "Scraped";
    case "screenshot":
      return "Screenshot";
    case "ai_generated":
      return "AI generated";
  }
}

export function canRegenerateAnalysis(asset: Asset): boolean {
  if (asset.source === "screenshot") return false;
  return asset.type === "image" || asset.mimeType?.startsWith("image/") || false;
}

export function getAssetTags(asset: Asset): AssetTagKey[] {
  const fromMeta = asset.metadata?.tags ?? [];
  const fromAnalysis = asset.metadata?.analysis?.tags ?? [];
  const typeTag = TYPE_TAG_MAP[asset.type];
  const tags = new Set<AssetTagKey>();
  for (const tag of [...fromMeta, ...fromAnalysis]) {
    if (isAssetTagKey(tag)) {
      tags.add(tag);
    }
  }
  if (typeTag) tags.add(typeTag);
  return Array.from(tags);
}

export function assetMatchesTag(asset: Asset, tagKey: AssetTagKey): boolean {
  return getAssetTags(asset).includes(tagKey);
}

export function getAssetPreviewUrl(asset: Asset): string {
  return asset.signedUrl || `/api/assets/${asset.uuid}/raw`;
}

export function getAssetTitle(asset: Asset): string {
  return asset.name;
}

export function getAssetFilename(asset: Asset): string {
  return asset.metadata?.filename ?? asset.name;
}

export function getAssetDescription(asset: Asset): string {
  return asset.metadata?.description ?? asset.metadata?.analysis?.description ?? "";
}

export function getAssetAltText(asset: Asset): string {
  return asset.metadata?.analysis?.altText ?? "";
}

export function getAssetAnalysis(asset: Asset): AssetAnalysis | undefined {
  return asset.metadata?.analysis;
}

export function isAssetAnalyzed(asset: Asset): boolean {
  return Boolean(asset.metadata?.analysis);
}

export function needsAnalysisReview(asset: Asset): boolean {
  return asset.metadata?.analysis?.safety?.needsReview ?? false;
}

export function getAnalysisQualityLabel(asset: Asset): string | null {
  const score = asset.metadata?.analysis?.quality.score;
  if (score == null) return null;
  if (score >= 4) return "High quality";
  if (score === 3) return "Average quality";
  return "Low quality";
}

export function buildAssetMetadata(
  base: AssetMetadata,
  updates: Partial<AssetMetadata>,
): AssetMetadata {
  return {
    ...base,
    ...updates,
    tags: updates.tags ?? base.tags,
  };
}
