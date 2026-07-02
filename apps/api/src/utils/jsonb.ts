import { sql, type RawBuilder } from "kysely";
import type { Json } from "../types/db";
import { sanitizeJsonValue } from "./sanitize-json";

/**
 * Stringify a JS value as a JSONB SQL expression.
 *
 * The `pg` driver serializes top-level JS arrays as PostgreSQL array literals,
 * which are not valid JSON. Passing a JSON string avoids that ambiguity for
 * all JSONB columns.
 *
 * Values are sanitized before stringifying so scraped metadata, EXIF, and LLM
 * responses containing control characters (e.g. U+0000) do not abort the
 * transaction with a Postgres JSONB serialization error.
 */
export function jsonb(value: unknown): RawBuilder<Json> {
  return sql<Json>`${JSON.stringify(sanitizeJsonValue(value))}::jsonb`;
}
