import { sql, type RawBuilder } from "kysely";
import type { Json } from "../types/db";

/**
 * Stringify a JS value as a JSONB SQL expression.
 *
 * The `pg` driver serializes top-level JS arrays as PostgreSQL array literals,
 * which are not valid JSON. Passing a JSON string avoids that ambiguity for
 * all JSONB columns.
 */
export function jsonb(value: unknown): RawBuilder<Json> {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}
