// apps/api/src/services/eval/checks/accessibility.ts
// Accessibility and contrast check using axe-core.

import { AxeBuilder } from "@axe-core/playwright";
import type { CheckContext } from "./check-context.js";
import type { PageEvalCategory, PageEvalIssue } from "../page-eval-report.js";
import { categoryPassed, issuesToScore, scoreToGrade } from "../page-eval-report.js";

export async function checkAccessibility(ctx: CheckContext): Promise<PageEvalCategory> {
  const issues: PageEvalIssue[] = [];

  try {
    const results = await new AxeBuilder({ page: ctx.page })
      .withTags(["wcag2aa"])
      .analyze();

    for (const violation of results.violations) {
      const impact = violation.impact ?? "minor";
      const severity = impact === "critical" || impact === "serious" ? "critical" : impact === "moderate" ? "major" : "minor";
      const message = `axe ${violation.id} (${impact}) — ${violation.help}`;
      const selector = violation.nodes[0]?.target?.join(", ");
      const fix = violation.helpUrl ? `See ${violation.helpUrl}` : undefined;

      // Surface contrast issues as major/critical because they make text unreadable
      if (violation.id === "color-contrast") {
        issues.push({
          severity: impact === "serious" ? "critical" : "major",
          category: "accessibility",
          message,
          selector,
          fix,
        });
        continue;
      }

      issues.push({
        severity,
        category: "accessibility",
        message,
        selector,
        fix,
      });
    }
  } catch (err) {
    issues.push({
      severity: "minor",
      category: "accessibility",
      message: `axe-core analysis failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const score = issuesToScore(issues);
  return {
    name: "accessibility",
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}
