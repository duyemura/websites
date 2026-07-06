import type { Page } from "playwright";

export interface ExtractedCss {
  tokens: Record<string, string>;
  breakpoints: string[];
  animations: Array<{ name: string; css: string }>;
  /** External stylesheet URLs for web fonts (Google Fonts, Adobe Fonts, etc.).
   *  Injected into the generated site's layout <head> so fonts render correctly. */
  webFontUrls: string[];
}

export async function extractCss(page: Page): Promise<ExtractedCss> {
  const inPage = await page.evaluate(`(function() {
    var tokens = {};
    var breakpoints = [];
    var animations = [];
    var crossOriginSheets = [];

    function walkRules(rules) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
          var props = Array.from(rule.style);
          for (var j = 0; j < props.length; j++) {
            var prop = props[j];
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
    }

    var sheets = Array.from(document.styleSheets);
    for (var i = 0; i < sheets.length; i++) {
      try {
        walkRules(sheets[i].cssRules);
      } catch (e) {
        if (sheets[i].href) crossOriginSheets.push(sheets[i].href);
      }
    }
    return {
      tokens: tokens,
      breakpoints: Array.from(new Set(breakpoints)),
      animations: animations,
      crossOriginSheets: crossOriginSheets,
    };
  })()`) as {
    tokens: Record<string, string>;
    breakpoints: string[];
    animations: Array<{ name: string; css: string }>;
    crossOriginSheets: string[];
  };

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

  const webFontPatterns = [
    "fonts.googleapis.com",
    "use.typekit.net",
    "use.fontawesome.com",
    "font-awesome",          // covers maxcdn.bootstrapcdn.com/font-awesome
    "fonts.bunny.net",
    "kit.fontawesome.com",
    "cdnjs.cloudflare.com/ajax/libs/font-awesome",
  ];
  const webFontUrls = inPage.crossOriginSheets.filter((href) =>
    webFontPatterns.some((p) => href.includes(p)),
  );
  const { crossOriginSheets: _dropped, ...rest } = inPage;
  return { ...rest, webFontUrls };
}
