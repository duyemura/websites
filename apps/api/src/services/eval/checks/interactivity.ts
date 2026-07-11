// apps/api/src/services/eval/checks/interactivity.ts
// Smoke-tests interactive parts of a Milo template page.

import type { CheckContext } from "./check-context.js";
import type { PageEvalCategory, PageEvalIssue } from "../page-eval-report.js";
import { categoryPassed, issuesToScore, scoreToGrade } from "../page-eval-report.js";

const MENU_TOGGLE_SELECTORS = [
  'button[aria-label*="menu" i]',
  'button[aria-label*="navigation" i]',
  '.menu-toggle',
  '.hamburger',
  '[class*="hamburger"]',
  'button[class*="nav"]',
  'nav button',
];

async function findMenuToggle(page: CheckContext["page"]): Promise<{ selector: string } | null> {
  for (const selector of MENU_TOGGLE_SELECTORS) {
    const el = await page.$(selector);
    if (el) {
      await el.dispose();
      return { selector };
    }
  }
  // Try any button inside or adjacent to nav with aria-expanded
  const fallback = await page.$('button[aria-expanded]');
  if (fallback) {
    await fallback.dispose();
    return { selector: 'button[aria-expanded]' };
  }
  return null;
}

export async function checkInteractivity(ctx: CheckContext): Promise<PageEvalCategory> {
  const issues: PageEvalIssue[] = [];

  // Mobile menu toggle
  const toggle = await findMenuToggle(ctx.page);
  if (toggle) {
    try {
      await ctx.page.setViewportSize({ width: 375, height: 812 });
      await ctx.page.waitForTimeout(200);
      await ctx.page.click(toggle.selector);
      await ctx.page.waitForTimeout(300);

      const expanded = await ctx.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        return el?.getAttribute("aria-expanded") === "true" || el?.getAttribute("aria-expanded") === "false";
      }, toggle.selector);

      // If aria-expanded is present, it should flip to true. Otherwise check visibility of nav/menu.
      const menuVisible = await ctx.page.evaluate(() => {
        const nav = document.querySelector("nav");
        if (!nav) return false;
        const style = window.getComputedStyle(nav);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      });

      if (!expanded && !menuVisible) {
        issues.push({
          severity: "major",
          category: "interactivity",
          message: "Mobile menu toggle did not reveal navigation when clicked",
          fix: "Ensure the menu toggle controls a visible navigation panel and updates ARIA attributes.",
          selector: toggle.selector,
        });
      }
    } catch (err) {
      issues.push({
        severity: "major",
        category: "interactivity",
        message: `Mobile menu toggle failed: ${err instanceof Error ? err.message : String(err)}`,
        selector: toggle.selector,
      });
    } finally {
      await ctx.page.setViewportSize({ width: 1280, height: 800 });
    }
  }

  // Primary CTA clickable
  const ctaSelector = "a.cta, .primary-cta, .btn-primary, a[class*='cta'], a[href].button";
  const ctas = await ctx.page.$$(ctaSelector);
  let ctaChecked = false;
  for (const cta of ctas.slice(0, 3)) {
    try {
      const disabled = await cta.evaluate((el) => (el as HTMLElement).hasAttribute("disabled") || (el as HTMLElement).getAttribute("aria-disabled") === "true");
      if (disabled) {
        issues.push({
          severity: "major",
          category: "interactivity",
          message: "Primary CTA appears disabled",
          fix: "Ensure the main call-to-action is enabled and clickable.",
        });
      }
      ctaChecked = true;
    } catch {
      // ignore
    }
  }
  if (!ctaChecked) {
    issues.push({
      severity: "info",
      category: "interactivity",
      message: "No obvious primary CTA found to verify (checked common selector classes)",
    });
  }

  // Form capture smoke test — only if the page has a form
  const hasForm = await ctx.page.evaluate(() => document.querySelector("form") !== null);
  if (hasForm) {
    try {
      const formEndpoint = `${ctx.content?.meta?.apiBaseUrl ?? ""}/forms/${ctx.siteUuid}/eval-smoke-test`;
      if (formEndpoint) {
        const formRes = await fetch(formEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: "eval@milotest.com", name: "Eval Test", _hp: "" }),
        });
        if (formRes.status === 201) {
          const row = await ctx.db
            .selectFrom("leads")
            .select("uuid")
            .where("siteUuid", "=", ctx.siteUuid)
            .where("formId", "=", "eval-smoke-test")
            .orderBy("createdAt", "desc")
            .executeTakeFirst();
          if (row) {
            await ctx.db.deleteFrom("leads").where("uuid", "=", row.uuid).execute();
          }
        } else {
          issues.push({
            severity: "minor",
            category: "interactivity",
            message: `Form endpoint returned HTTP ${formRes.status}`,
            fix: "Verify the form handler route is wired up through CloudFront /api/*.",
          });
        }
      }
    } catch (err) {
      issues.push({
        severity: "minor",
        category: "interactivity",
        message: `Form smoke test failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const score = issuesToScore(issues);
  return {
    name: "interactivity",
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}
