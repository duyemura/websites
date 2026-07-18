/**
 * Shared Astro component sanitizer for LLM-generated output.
 *
 * Guards against the most common LLM mistakes that break the Astro build or the
 * component-eval harness. Applied both at scaffold time (code-scaffolder.ts) and
 * after every agent-fix write (eval-loop.ts), and by validateAstroComponent in
 * astro-generator.ts.
 */
const FORBIDDEN_RENDERER_PACKAGES = ["astro-icon", "@iconify", "lucide-react", "react-icons"];

/**
 * Strip only the forbidden `import` statements from a frontmatter string, not
 * entire lines. This prevents collateral damage when the LLM places multiple
 * statements on one line:
 *   import Foo from "./Foo.astro"; import { Icon } from "astro-icon";
 * A line-based filter would drop Foo too. A statement-level regex only removes
 * the forbidden statement.
 */
function stripForbiddenImportsFromFrontmatter(fm: string, forbidden: string[], componentName: string): string {
  let result = fm;
  for (const pkg of forbidden) {
    const before = result;
    // Match: import ... from "pkg" or import ... from 'pkg' — with optional semicolon
    result = result.replace(
      new RegExp(`import\\s+[^;]*from\\s+['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"];?`, "g"),
      "",
    );
    if (result !== before) {
      console.warn(`[astro-sanitize] ${componentName}: removed frontmatter import of "${pkg}"`);
    }
  }
  return result;
}

/**
 * Replace `<Icon .../>` self-closing elements with a placeholder span.
 *
 * The previous regex `<Icon\s[^/]*` stopped at the first `/` in attribute
 * values like `src="/img/x.svg"`, producing malformed output. This version
 * matches the full self-closing element using `[^>]*` so attribute values
 * containing `/` are handled correctly.
 */
function stripIconUsages(code: string, componentName: string): string {
  const before = code;
  // Match full <Icon ... /> element — greedy up to the self-close
  const result = code.replace(/<Icon\b[^>]*\/?>/g, "<span><!-- icon removed --></span>");
  if (result !== before) {
    console.warn(`[astro-sanitize] ${componentName}: replaced <Icon> usages with placeholder spans`);
  }
  return result;
}

/**
 * Strip forbidden package imports from frontmatter (statement-level), remove
 * <script> blocks that reference them, and replace any leftover <Icon> elements.
 *
 * This is the "stripping only" step — it does NOT do brace balancing, map-var
 * defaults, or eval-component injection. It is called by both sanitizeAstroComponent
 * (full sanitizer) and by validateAstroComponent in astro-generator.ts (structural
 * validator that wants stripping but manages its own structural checks).
 */
export function stripForbiddenPackages(code: string, componentName: string): string {
  let s = code;

  // Strip forbidden third-party imports from frontmatter (statement-level).
  const fmStart = s.indexOf("---");
  const fmEnd = fmStart !== -1 ? s.indexOf("---", fmStart + 3) : -1;
  if (fmStart !== -1 && fmEnd !== -1) {
    const fmSlice = s.slice(fmStart + 3, fmEnd);
    const fmCleaned = stripForbiddenImportsFromFrontmatter(fmSlice, FORBIDDEN_RENDERER_PACKAGES, componentName);
    if (fmCleaned !== fmSlice) {
      s = `---${fmCleaned}${s.slice(fmEnd)}`;
      // Also remove <Icon ...> usages left behind after stripping the import
      s = stripIconUsages(s, componentName);
    }
  }

  // Strip <script> blocks that import forbidden third-party packages.
  s = s.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (fullMatch, scriptBody: string) => {
    const hasForbidden = FORBIDDEN_RENDERER_PACKAGES.some(
      (pkg) => scriptBody.includes(`"${pkg}"`) || scriptBody.includes(`'${pkg}'`),
    );
    if (hasForbidden) {
      console.warn(`[astro-sanitize] ${componentName}: removed <script> block with unresolvable import`);
      return "";
    }
    return fullMatch;
  });

  return s;
}

export function sanitizeAstroComponent(code: string, componentName: string): string {
  let s = code;

  // 0. Strip forbidden third-party imports + <script> blocks + <Icon> usages.
  s = stripForbiddenPackages(s, componentName);

  // 1. (Script stripping already handled by stripForbiddenPackages above.)

  // 2. Fix `<style scoped>` → `<style>` (Vue syntax, invalid in Astro).
  s = s.replace(/<style\s+scoped>/g, "<style>");

  // 3. Strip JSX `key={...}` props — React-specific, invalid in Astro templates.
  s = s.replace(/\s+key=\{[^}]*\}/g, "");

  // 4. If the frontmatter is never closed (truncated output), complete it with a
  //    minimal placeholder so the build doesn't fail on a syntax error.
  const fenceCount = (s.match(/^---$/gm) ?? []).length;
  if (fenceCount < 2) {
    s = s.trimEnd() + `\n---\n\n<section data-eval-component="${componentName}" class="unknown-section"><div class="unknown-section__inner"></div></section>\n`;
    return s;
  }

  // 5. Balance CSS braces in <style> blocks (truncated output leaves unclosed blocks).
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

  // 6. Add `= []` defaults for variables called with .map() in the template.
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

  // 7. Inject data-eval-component on the first HTML element if missing.
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
