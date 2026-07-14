// apps/api/src/services/template/placeholder-validator.ts
// Validates that generated GymSiteContent satisfies the template spec's
// required-field and placeholder policy before a build is promoted or published.

import type { TemplateSpec, PageSpec } from "@milo/shared-types";

export interface PlaceholderIssue {
  pageKey: string;
  field: string;
  severity: "error" | "warn";
  message: string;
}

export interface PlaceholderReport {
  issues: PlaceholderIssue[];
  blocking: boolean;
}

const PLACEHOLDER_TEXTS = new Set([
  "__PLACEHOLDER__",
  "__NO_IMAGE__",
  "",
]);

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(key)) {
      return (acc as unknown[])[Number(key)];
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isPlaceholder(value: unknown): boolean {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return PLACEHOLDER_TEXTS.has(trimmed);
  }
  return false;
}

function checkField(
  pageKey: string,
  fieldPath: string,
  value: unknown,
  policy: PageSpec["placeholderPolicy"],
): PlaceholderIssue | undefined {
  if (isEmpty(value)) {
    return {
      pageKey,
      field: fieldPath,
      severity: policy === "block-publish" ? "error" : "warn",
      message: `${fieldPath} is missing`,
    };
  }
  if (isPlaceholder(value)) {
    return {
      pageKey,
      field: fieldPath,
      severity: policy === "block-publish" ? "error" : "warn",
      message: `${fieldPath} contains a placeholder value`,
    };
  }
  return undefined;
}

/**
 * Scan GymSiteContent against the template spec. For every page with requiredFields,
 * check that the path resolves to real, non-placeholder content.
 */
export function validateContentPlaceholders(
  content: Record<string, unknown>,
  spec: TemplateSpec,
): PlaceholderReport {
  const issues: PlaceholderIssue[] = [];

  for (const [pageKey, page] of Object.entries(spec.pages)) {
    if (!page.requiredFields?.length) continue;
    const policy = page.placeholderPolicy ?? "allow";

    for (const fieldPath of page.requiredFields) {
      const value = getPath(content, fieldPath);
      const issue = checkField(pageKey, fieldPath, value, policy);
      if (issue) issues.push(issue);
    }
  }

  const blocking = issues.some((i) => i.severity === "error");
  return { issues, blocking };
}
