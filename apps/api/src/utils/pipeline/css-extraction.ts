import type { Page } from "playwright";

export interface ExtractedCss {
  tokens: Record<string, string>;
  breakpoints: string[];
  animations: Array<{ name: string; css: string }>;
}

export async function extractCss(page: Page): Promise<ExtractedCss> {
  const inPage = await page.evaluate(() => {
    const tokens: Record<string, string> = {};
    const breakpoints: string[] = [];
    const animations: Array<{ name: string; css: string }> = [];
    const crossOriginSheets: string[] = [];

    const walkRules = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
          for (const prop of Array.from(rule.style)) {
            if (prop.startsWith("--"))
              tokens[prop] = rule.style.getPropertyValue(prop).trim();
          }
        } else if (rule instanceof CSSMediaRule) {
          breakpoints.push(rule.conditionText);
          walkRules(rule.cssRules);
        } else if (rule instanceof CSSKeyframesRule) {
          animations.push({ name: rule.name, css: rule.cssText });
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walkRules(sheet.cssRules);
      } catch {
        if (sheet.href) crossOriginSheets.push(sheet.href);
      }
    }
    return {
      tokens,
      breakpoints: [...new Set(breakpoints)],
      animations,
      crossOriginSheets,
    };
  });

  // Cross-origin sheets: fetch text and regex-parse (no CSSOM access).
  for (const href of inPage.crossOriginSheets) {
    try {
      const text = await page.evaluate(
        async (url) => (await fetch(url)).text(),
        href,
      );
      for (const m of text.matchAll(/--[\w-]+\s*:\s*[^;}]+/g)) {
        const [prop, ...rest] = m[0].split(":");
        if (prop) inPage.tokens[prop.trim()] ??= rest.join(":").trim();
      }
      for (const m of text.matchAll(/@media\s*([^{]+)\{/g)) {
        const cond = m[1]?.trim();
        if (cond && !inPage.breakpoints.includes(cond))
          inPage.breakpoints.push(cond);
      }
      for (const m of text.matchAll(/@keyframes\s+([\w-]+)/g)) {
        const name = m[1];
        if (name && !inPage.animations.some((a) => a.name === name)) {
          inPage.animations.push({ name, css: "" });
        }
      }
    } catch {
      // unreachable sheet — skip; tokens from reachable sources still apply
    }
  }

  const { crossOriginSheets: _dropped, ...result } = inPage;
  return result;
}
