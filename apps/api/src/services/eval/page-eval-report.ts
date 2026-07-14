// apps/api/src/services/eval/page-eval-report.ts
// Shared types and scoring utilities for the per-page Milo QA evaluator.

export interface PageEvalIssue {
  severity: "critical" | "major" | "minor" | "info";
  category: PageEvalCategoryName;
  message: string;
  /** Suggested fix, if one is known. */
  fix?: string;
  /** DOM selector related to the issue, when applicable. */
  selector?: string;
  /** Hierarchy section id this issue belongs to, when known. */
  sectionId?: string;
}

export type PageEvalCategoryName =
  | "accessibility"
  | "seo"
  | "links"
  | "interactivity"
  | "performance"
  | "content"
  | "visual";

export interface PageEvalCategory {
  name: PageEvalCategoryName;
  score: number;
  grade: string;
  status: "passed" | "failed";
  issues: PageEvalIssue[];
}

export interface PageEvalMetadata {
  url: string;
  path: string;
  title: string | null;
  h1: string | null;
  wordCount: number;
  loadTimeMs: number;
  screenshotUrl?: string | null;
}

export interface PageEvalActionItem {
  priority: "critical" | "major" | "minor" | "info";
  category: PageEvalCategoryName;
  message: string;
  fix: string;
  selector?: string;
  /** Hierarchy section id this action targets, when known. */
  sectionId?: string;
}

export interface PageEvalReport {
  overall: {
    score: number;
    grade: string;
    status: "passed" | "failed";
    /** Short technical summary for logs/agent consumption. */
    summary: string;
    /** Plain-language summary suitable for client presentation. */
    clientSummary: string;
    /** Prioritized, actionable fix list for an AI agent or developer. */
    actionItems: PageEvalActionItem[];
  };
  categories: PageEvalCategory[];
  metadata: PageEvalMetadata;
}

export const CATEGORY_WEIGHTS: Record<PageEvalCategoryName, number> = {
  accessibility: 0.20,
  seo: 0.15,
  links: 0.15,
  interactivity: 0.15,
  performance: 0.15,
  content: 0.15,
  visual: 0.05,
};

/**
 * Convert a numeric score (0–100) into a letter grade.
 */
export function scoreToGrade(score: number): string {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Score starts at 100 and is reduced by issue severity.
 * Critical issues floor the category at 0 if any are present.
 */
export function issuesToScore(issues: PageEvalIssue[]): number {
  if (issues.some((i) => i.severity === "critical")) return 0;
  const penalties: Record<PageEvalIssue["severity"], number> = {
    critical: 50,
    major: 15,
    minor: 5,
    info: 1,
  };
  let score = 100;
  for (const issue of issues) {
    score -= penalties[issue.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, score));
}

export function categoryPassed(score: number, issues: PageEvalIssue[]): boolean {
  return score >= 70 && !issues.some((i) => i.severity === "critical");
}

export function computeOverallScore(categories: PageEvalCategory[]): number {
  let weighted = 0;
  let weightSum = 0;
  for (const cat of categories) {
    const weight = CATEGORY_WEIGHTS[cat.name] ?? 0;
    weighted += cat.score * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return 0;
  return Math.round(weighted / weightSum);
}

export function buildSummary(report: PageEvalReport): string {
  const criticalCount = report.categories.flatMap((c) => c.issues).filter((i) => i.severity === "critical").length;
  const totalIssues = report.categories.flatMap((c) => c.issues).length;
  const failedCategories = report.categories.filter((c) => c.status === "failed").map((c) => c.name);

  if (criticalCount > 0) {
    return `${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} must be fixed before this page is presentable. Overall ${report.overall.grade} (${report.overall.score}).`;
  }
  if (failedCategories.length > 0) {
    return `Page is usable but ${failedCategories.join(", ")} need attention. ${totalIssues} issue${totalIssues === 1 ? "" : "s"} total. Overall ${report.overall.grade} (${report.overall.score}).`;
  }
  return `Page looks presentable. ${totalIssues === 0 ? "No issues found" : `${totalIssues} minor issue${totalIssues === 1 ? "" : "s"}`}. Overall ${report.overall.grade} (${report.overall.score}).`;
}

export function buildClientSummary(report: PageEvalReport): string {
  const criticalCount = report.categories.flatMap((c) => c.issues).filter((i) => i.severity === "critical").length;
  const majorCount = report.categories.flatMap((c) => c.issues).filter((i) => i.severity === "major").length;
  const totalIssues = report.categories.flatMap((c) => c.issues).length;
  const failedCategories = report.categories.filter((c) => c.status === "failed").map((c) => c.name);

  if (criticalCount > 0) {
    return `This page needs fixes before it can go live. We found ${criticalCount} critical problem${criticalCount === 1 ? "" : "s"} (${totalIssues} total) that would block a client review. Overall grade: ${report.overall.grade}.`;
  }
  if (failedCategories.length > 0) {
    return `This page is close but still needs polish. ${majorCount} important issue${majorCount === 1 ? "" : "s"} in ${failedCategories.join(", ")} should be addressed before showing a client. Overall grade: ${report.overall.grade}.`;
  }
  if (totalIssues > 0) {
    return `This page looks good and is client-ready. We found ${totalIssues} minor suggestion${totalIssues === 1 ? "" : "s"} for further polish. Overall grade: ${report.overall.grade}.`;
  }
  return `This page looks great — no issues found. Overall grade: ${report.overall.grade}.`;
}

export function buildActionItems(categories: PageEvalCategory[]): PageEvalActionItem[] {
  const severityRank: Record<PageEvalIssue["severity"], number> = {
    critical: 0,
    major: 1,
    minor: 2,
    info: 3,
  };
  const items = categories
    .flatMap((cat) =>
      cat.issues.map((issue) => ({
        priority: issue.severity,
        category: cat.name,
        message: issue.message,
        fix: issue.fix ?? "Investigate and resolve.",
        selector: issue.selector,
      })),
    )
    .sort((a, b) => severityRank[a.priority] - severityRank[b.priority]);
  return items;
}

export function renderMarkdownReport(report: PageEvalReport): string {
  const lines: string[] = [];
  lines.push(`# Page QA Report — ${report.metadata.path || "/"}`);
  lines.push("");
  lines.push(`**URL:** ${report.metadata.url}`);
  lines.push(`**Overall:** ${report.overall.grade} (${report.overall.score}/100) — ${report.overall.status}`);
  lines.push("");
  lines.push(`> ${report.overall.clientSummary}`);
  lines.push("");
  lines.push("## Category breakdown");
  lines.push("");
  lines.push("| Category | Grade | Score | Status | Issues |");
  lines.push("|---|---|---|---|---|");
  for (const cat of report.categories) {
    lines.push(`| ${cat.name} | ${cat.grade} | ${cat.score} | ${cat.status} | ${cat.issues.length} |`);
  }
  lines.push("");

  const actionable = report.overall.actionItems.filter((i) => i.priority !== "info");
  if (actionable.length > 0) {
    lines.push("## Action items");
    lines.push("");
    for (const item of actionable) {
      lines.push(`### [${item.priority.toUpperCase()}] ${item.category}: ${item.message}`);
      lines.push(`**Fix:** ${item.fix}`);
      if (item.selector) lines.push(`**Selector:** \`${item.selector}\``);
      lines.push("");
    }
  }

  lines.push("## Page metadata");
  lines.push("");
  lines.push(`- Title: ${report.metadata.title ?? "none"}`);
  lines.push(`- H1: ${report.metadata.h1 ?? "none"}`);
  lines.push(`- Word count: ${report.metadata.wordCount}`);
  lines.push(`- Load time: ${report.metadata.loadTimeMs}ms`);
  if (report.metadata.screenshotUrl) lines.push(`- Screenshot: ${report.metadata.screenshotUrl}`);
  lines.push("");

  return lines.join("\n");
}

export interface SiteEvalPageSummary {
  path: string;
  score: number;
  grade: string;
  status: "passed" | "failed";
  title: string | null;
  totalIssues: number;
  criticalIssues: number;
}

export interface SiteEvalSummary {
  totalPages: number;
  passedPages: number;
  failedPages: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
  worstPath: string;
  totalIssues: number;
  criticalIssues: number;
}

export interface SiteEvalReport {
  evaluatedAt: string;
  pages: PageEvalReport[];
  summaries: SiteEvalPageSummary[];
  summary: SiteEvalSummary;
}

export function buildSiteEvalReport(pages: PageEvalReport[]): SiteEvalReport {
  const summaries: SiteEvalPageSummary[] = pages.map((p) => {
    const issues = p.categories.flatMap((c) => c.issues);
    return {
      path: p.metadata.path,
      score: p.overall.score,
      grade: p.overall.grade,
      status: p.overall.status,
      title: p.metadata.title,
      totalIssues: issues.length,
      criticalIssues: issues.filter((i) => i.severity === "critical").length,
    };
  });

  const scores = pages.map((p) => p.overall.score);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const worstPage = pages.find((p) => p.overall.score === minScore) ?? pages[0];
  const totalIssues = pages.reduce((sum, p) => sum + p.categories.flatMap((c) => c.issues).length, 0);
  const criticalIssues = pages.reduce(
    (sum, p) => sum + p.categories.flatMap((c) => c.issues).filter((i) => i.severity === "critical").length,
    0,
  );

  return {
    evaluatedAt: new Date().toISOString(),
    pages,
    summaries,
    summary: {
      totalPages: pages.length,
      passedPages: pages.filter((p) => p.overall.status === "passed").length,
      failedPages: pages.filter((p) => p.overall.status === "failed").length,
      avgScore,
      minScore,
      maxScore,
      worstPath: worstPage?.metadata.path ?? "",
      totalIssues,
      criticalIssues,
    },
  };
}

export function finalizeReport(categories: PageEvalCategory[], metadata: PageEvalMetadata): PageEvalReport {
  const score = computeOverallScore(categories);
  const grade = scoreToGrade(score);
  const anyCritical = categories.some((c) => c.issues.some((i) => i.severity === "critical"));
  const report: PageEvalReport = {
    overall: {
      score,
      grade,
      status: anyCritical || score < 70 ? "failed" : "passed",
      summary: "",
      clientSummary: "",
      actionItems: [],
    },
    categories,
    metadata,
  };
  report.overall.summary = buildSummary(report);
  report.overall.clientSummary = buildClientSummary(report);
  report.overall.actionItems = buildActionItems(categories);
  return report;
}
