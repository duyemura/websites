import { z } from "zod";

/**
 * Strict registry of all doc keys the system is allowed to create.
 *
 * No route, worker, or AI prompt should create a doc whose key is not listed here.
 * If a new doc type is needed, add it to this registry and to the doc standards doc
 * (`docs/design/site-doc-standards.md`) first.
 */
export const ALLOWED_DOC_KEYS = [
  "workspace-memory",
  "site-memory",
  "brand-guidelines",
  "business-info",
  "site-strategy",
  "site-hierarchy",
  "design-system",
  "section-visual-evidence",
  "blueprint-draft",
] as const;

export type AllowedDocKey = (typeof ALLOWED_DOC_KEYS)[number];

export const AllowedDocKeySchema = z.enum(ALLOWED_DOC_KEYS);

export function isAllowedDocKey(key: string): key is AllowedDocKey {
  return ALLOWED_DOC_KEYS.includes(key as AllowedDocKey);
}

export function assertAllowedDocKey(key: string): asserts key is AllowedDocKey {
  if (!isAllowedDocKey(key)) {
    throw new Error(
      `Doc key "${key}" is not in the allowed registry. ` +
        `Allowed keys: ${ALLOWED_DOC_KEYS.join(", ")}. ` +
        `Add it to apps/api/src/utils/doc-registry.ts and docs/design/site-doc-standards.md first.`,
    );
  }
}
