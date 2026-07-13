import type { MirrorAsset } from "../../types/mirror";

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);

function isPhotoAsset(asset: MirrorAsset): boolean {
  const ct = asset.contentType.toLowerCase();
  if (!ct.startsWith("image/")) return false;
  if (/svg/.test(ct)) return false;
  const localLower = asset.localPath.toLowerCase();
  const lastDot = localLower.lastIndexOf(".");
  const ext = lastDot >= 0 ? localLower.slice(lastDot) : "";
  return PHOTO_EXTENSIONS.has(ext);
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "your", "our", "are", "have",
  "will", "can", "you", "more", "info", "learn", "click", "here", "read", "about",
  "https", "http", "www", "com", "png", "jpg", "jpeg", "webp", "avif",
]);

function buildCandidateText(asset: MirrorAsset): string {
  const parts: string[] = [];
  if (asset.visionTags) parts.push(...asset.visionTags);
  if (asset.visionDescription) parts.push(asset.visionDescription);
  if (asset.visionContexts) parts.push(...asset.visionContexts);
  if (asset.visionSubject) parts.push(asset.visionSubject);
  if (asset.appearances) {
    for (const a of asset.appearances) {
      parts.push(a.sectionType);
      if (a.sectionHeading) parts.push(a.sectionHeading);
      if (a.sectionBody) parts.push(a.sectionBody);
    }
  }
  return parts.join(" ");
}

function scoreMatch(queryTokens: string[], candidateText: string): number {
  const candidateTokens = normalize(candidateText);
  if (candidateTokens.length === 0 || queryTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  let matches = 0;
  let rareMatches = 0;

  for (const qt of queryTokens) {
    if (candidateSet.has(qt)) {
      matches += 1;
      // Slightly weight rarer, more specific matches higher.
      if (candidateSet.size < 20 || qt.length >= 6) rareMatches += 1;
    }
  }

  return matches + rareMatches * 0.5;
}

export interface MatchOptions {
  /** Tokens/keywords describing the desired image context. */
  query: string;
  /** Assets to exclude from consideration. */
  exclude?: Set<string>;
  /** Prefer an asset whose appearance context includes this section type. */
  preferredSectionType?: string;
}

export interface ImageMatcher {
  /** Pick the best matching asset localPath for the given context. Returns undefined if no suitable photo. */
  match(options: MatchOptions): string | undefined;
  /** List all photo assets in the pool. */
  photos: MirrorAsset[];
}

export function buildImageMatcher(assets: MirrorAsset[]): ImageMatcher {
  const photos = assets.filter(isPhotoAsset);

  function match(options: MatchOptions): string | undefined {
    const queryTokens = normalize(options.query);
    let best: { asset: MirrorAsset; score: number } | undefined;

    for (const asset of photos) {
      if (options.exclude?.has(asset.localPath)) continue;

      let candidateScore = scoreMatch(queryTokens, buildCandidateText(asset));

      // Small bonus if the asset appeared in the preferred section type.
      if (options.preferredSectionType && asset.appearances?.some(
        (a) => a.sectionType.toLowerCase() === options.preferredSectionType?.toLowerCase(),
      )) {
        candidateScore += 0.75;
      }

      // Prefer assets with vision tags when scores are otherwise tied.
      if (asset.visionTags && asset.visionTags.length > 0) candidateScore += 0.1;

      if (!best || candidateScore > best.score) {
        best = { asset, score: candidateScore };
      }
    }

    // Only return a match if we found some contextual overlap. Otherwise caller should fallback.
    if (best && best.score > 0.5) return best.asset.localPath;
    return undefined;
  }

  return { match, photos };
}

/**
 * Round-robin fallback when no contextual match is good enough.
 * Tracks previously used paths to avoid repeating the same image in many slots.
 */
export function makeRoundRobin(assets: MirrorAsset[], used = new Set<string>()) {
  const photos = assets.filter(isPhotoAsset);
  let idx = 0;
  return function next(exclude?: Set<string>): string | undefined {
    const excluded = exclude ? new Set([...used, ...exclude]) : used;
    const available = photos.filter((p) => !excluded.has(p.localPath));
    if (available.length === 0) {
      // If everything is excluded, reset and try again.
      used.clear();
      const reset = photos.filter((p) => !exclude?.has(p.localPath));
      if (reset.length === 0) return undefined;
      const pick = reset[idx % reset.length];
      if (!pick) return undefined;
      idx = (idx + 1) % reset.length;
      used.add(pick.localPath);
      return pick.localPath;
    }
    const pick = available[idx % available.length];
    if (!pick) return undefined;
    idx = (idx + 1) % available.length;
    used.add(pick.localPath);
    return pick.localPath;
  };
}
