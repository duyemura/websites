export function makeDocKey(title: string, providedKey?: string): string {
  if (providedKey !== undefined) {
    return providedKey.trim().toLowerCase().replace(/\s+/g, "-");
  }

  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
