/**
 * Recursively strip characters that PostgreSQL's JSONB serializer rejects.
 *
 * Postgres accepts full JSON but rejects the Unicode null character (U+0000)
 * inside string values. Lone surrogate halves can also make the JSON parser
 * reject a value. This function removes U+0000 and replaces lone surrogates
 * with the replacement character so arbitrary upstream data (EXIF, LLM
 * responses, scraped metadata) can be stored as JSONB.
 *
 * @param value - Any JSON-serializable value.
 * @returns A value safe to pass through `JSON.stringify` and into a JSONB column.
 */
export function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .split("\0")
      .join("")
      .replace(/[\uD800-\uDFFF]/g, (char, offset, string) => {
        const code = char.charCodeAt(0);
        // High surrogate must be followed by low surrogate; low surrogate must
        // be preceded by high surrogate. Anything else is invalid.
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = string.charCodeAt(offset + 1);
          if (next >= 0xdc00 && next <= 0xdfff) return char;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          const prev = offset > 0 ? string.charCodeAt(offset - 1) : 0;
          if (prev >= 0xd800 && prev <= 0xdbff) return char;
        }
        return "�";
      })
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitizeJsonValue(val);
    }
    return result;
  }

  return value;
}
