export interface FingerprintInput {
  pageId: string;
  sectionId: string;
  tag: string;
  innerText: string;
  mediaUrls: string[];
  aspectRatio: number;
}

export interface Fingerprint extends FingerprintInput {
  normalizedText: string;
  memberKey: string; // "page:sectionId"
}

export interface SharedComponentResolution {
  id: string;
  tag: string;
  memberSectionIds: string[];
  resolution: "normalized" | "props";
  canonicalText?: string; // for normalized
  propFields?: string[]; // for props — divergent word positions summary
}

const PROMOTE_NORMALIZED = 0.95;
const PROMOTE_PROPS = 0.7;

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function bigrams(s: string): string[] {
  const n = normalizeText(s);
  if (n.length < 2) return n.length === 1 ? [n] : [];
  const out: string[] = [];
  for (let i = 0; i < n.length - 1; i++) out.push(n.slice(i, i + 2));
  return out;
}

// Character-bigram Dice coefficient — robust to small token drifts (e.g. one changed digit
// inside a phone number). Cheap and adequate for section-scale text.
export function textSimilarity(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.length === 0 && bb.length === 0) return 1;
  if (ba.length === 0 || bb.length === 0) return 0;
  const setB = new Map<string, number>();
  for (const t of bb) setB.set(t, (setB.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of ba) {
    const count = setB.get(t) ?? 0;
    if (count > 0) {
      common += 1;
      setB.set(t, count - 1);
    }
  }
  return (2 * common) / (ba.length + bb.length);
}

export function fingerprintSections(sections: FingerprintInput[]): Fingerprint[] {
  return sections.map((s) => ({
    ...s,
    normalizedText: normalizeText(s.innerText),
    memberKey: `${s.pageId}:${s.sectionId}`,
  }));
}

export function resolveSharedComponents(prints: Fingerprint[]): SharedComponentResolution[] {
  // Group by tag; within a tag, cluster greedily by similarity to the cluster seed.
  const byTag = new Map<string, Fingerprint[]>();
  for (const p of prints) {
    byTag.set(p.tag, [...(byTag.get(p.tag) ?? []), p]);
  }

  const results: SharedComponentResolution[] = [];
  let counter = 0;

  for (const [tag, group] of byTag) {
    const unassigned = [...group];
    while (unassigned.length > 1) {
      const seed = unassigned.shift();
      if (!seed) break;
      const cluster: Fingerprint[] = [seed];
      // Iterate forward to preserve original order; walk indices in reverse only for safe splicing.
      const matchIndices: number[] = [];
      for (let i = 0; i < unassigned.length; i++) {
        const candidate = unassigned[i];
        if (!candidate) continue;
        // sections on the SAME page never share (a page can't reuse into itself here)
        if (candidate.pageId === seed.pageId) continue;
        if (textSimilarity(seed.innerText, candidate.innerText) >= PROMOTE_PROPS) {
          matchIndices.push(i);
          cluster.push(candidate);
        }
      }
      // Remove matched entries from unassigned in reverse index order.
      for (let k = matchIndices.length - 1; k >= 0; k--) {
        const idx = matchIndices[k];
        if (idx === undefined) continue;
        unassigned.splice(idx, 1);
      }
      if (cluster.length < 2) continue;

      const minPairSim = minPairwiseSimilarity(cluster);
      const resolution: "normalized" | "props" =
        minPairSim >= PROMOTE_NORMALIZED ? "normalized" : "props";

      results.push({
        id: `shared-${counter++}`,
        tag,
        memberSectionIds: cluster.map((c) => c.memberKey),
        resolution,
        canonicalText: resolution === "normalized" ? mostFrequentText(cluster) : undefined,
        propFields: resolution === "props" ? divergentFields(cluster) : undefined,
      });
    }
  }
  return results;
}

function minPairwiseSimilarity(cluster: Fingerprint[]): number {
  let min = 1;
  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      const a = cluster[i];
      const b = cluster[j];
      if (!a || !b) continue;
      min = Math.min(min, textSimilarity(a.innerText, b.innerText));
    }
  }
  return min;
}

function mostFrequentText(cluster: Fingerprint[]): string {
  const counts = new Map<string, { count: number; original: string; isHome: boolean }>();
  for (const c of cluster) {
    const entry = counts.get(c.normalizedText) ?? { count: 0, original: c.innerText, isHome: false };
    entry.count += 1;
    if (c.pageId === "/") entry.isHome = true;
    counts.set(c.normalizedText, entry);
  }
  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || Number(b.isHome) - Number(a.isHome),
  );
  // ranked is non-empty because cluster.length >= 2 upstream
  return ranked[0]?.original ?? "";
}

function divergentFields(cluster: Fingerprint[]): string[] {
  // Word positions that differ across variants, reported as "word-N" markers.
  const tokenLists = cluster.map((c) => c.normalizedText.split(" "));
  const maxLen = Math.max(...tokenLists.map((t) => t.length));
  const fields: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const values = new Set(tokenLists.map((t) => t[i] ?? ""));
    if (values.size > 1) fields.push(`word-${i}`);
  }
  return fields;
}
