/**
 * Shared Astro component sanitizer for LLM-generated output.
 *
 * Guards against the most common LLM mistakes that break the Astro build or the
 * component-eval harness. Applied both at scaffold time (code-scaffolder.ts) and
 * after every agent-fix write (eval-loop.ts).
 */
export function sanitizeAstroComponent(code: string, componentName: string): string {
  let s = code;

  // 1. Fix `<style scoped>` → `<style>` (Vue syntax, invalid in Astro).
  s = s.replace(/<style\s+scoped>/g, "<style>");

  // 2. Strip JSX `key={...}` props — React-specific, invalid in Astro templates.
  s = s.replace(/\s+key=\{[^}]*\}/g, "");

  // 3. If the frontmatter is never closed (truncated output), complete it with a
  //    minimal placeholder so the build doesn't fail on a syntax error.
  const fenceCount = (s.match(/^---$/gm) ?? []).length;
  if (fenceCount < 2) {
    s = s.trimEnd() + `\n---\n\n<section data-eval-component="${componentName}" class="unknown-section"><div class="unknown-section__inner"></div></section>\n`;
    return s;
  }

  // 4. Balance CSS braces in <style> blocks (truncated output leaves unclosed blocks).
  const styleStart = s.indexOf("<style>");
  const styleEnd = s.lastIndexOf("</style>");
  if (styleStart !== -1) {
    const css = styleEnd !== -1 ? s.slice(styleStart + 7, styleEnd) : s.slice(styleStart + 7);
    const missing = (css.match(/\{/g) ?? []).length - (css.match(/\}/g) ?? []).length;
    if (missing > 0) {
      const closers = "\n}\n".repeat(missing);
      s = styleEnd !== -1
        ? s.slice(0, styleEnd) + closers + s.slice(styleEnd)
        : s + closers + "\n</style>";
    }
  }

  // 5. Add `= []` defaults for variables called with .map() in the template.
  //    LLM components sometimes use different prop names than the spec, causing
  //    "Cannot read .map() of undefined" at render time.
  const fenceForTemplate = s.indexOf("---", s.indexOf("---") + 3);
  const templateSection = fenceForTemplate !== -1 ? s.slice(fenceForTemplate + 3) : "";
  const mapVarNames = [...new Set([...templateSection.matchAll(/\b(\w+)\.map\s*\(/g)].map((m) => m[1]))];
  if (mapVarNames.length > 0) {
    s = s.replace(
      /const\s*\{([^}]+)\}\s*=\s*Astro\.props/,
      (match, inner: string) => {
        let patched = inner;
        // Strip string literals before checking for existing defaults, to avoid
        // false positives like `id = "someVar = []"` tricking the regex.
        const strippedInner = inner.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
        for (const varName of mapVarNames) {
          const alreadyDefaulted = new RegExp(`\\b${varName}\\s*=\\s*\\[`).test(strippedInner);
          if (!alreadyDefaulted) {
            patched = patched.replace(new RegExp(`\\b(${varName})\\b(?!\\s*[=?])`), "$1 = []");
          }
        }
        return `const { ${patched.trim()} } = Astro.props`;
      },
    );
  }

  // 6. Inject data-eval-component on the first HTML element if missing.
  //    The eval harness uses [data-eval-component="Name"] to crop component screenshots.
  if (!s.includes(`data-eval-component="${componentName}"`)) {
    const firstFence = s.indexOf("---");
    const secondFence = firstFence !== -1 ? s.indexOf("---", firstFence + 3) : -1;
    if (secondFence !== -1) {
      const tpl = s.slice(secondFence + 3);
      const tagMatch = tpl.match(/<([a-z][a-z0-9-]*)(\s[^>]*)?>/);
      if (tagMatch) {
        const tagIndex = tpl.indexOf(tagMatch[0]);
        const nameEnd = secondFence + 3 + tagIndex + 1 + (tagMatch[1]?.length ?? 0);
        s = s.slice(0, nameEnd) + ` data-eval-component="${componentName}"` + s.slice(nameEnd);
      }
    }
  }

  return s;
}
