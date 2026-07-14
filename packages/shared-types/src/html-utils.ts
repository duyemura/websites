/**
 * Minimal, dependency-free HTML sanitizer for rich-text fields that travel from
 * extracted source sites or LLM output into GymSiteContent.
 *
 * We intentionally do NOT use a full parser/DOM library here to keep shared-types
 * lightweight. The allowlist below is strict: only basic typographic and
 * structural markup survives. Anything else is stripped, including event
 * handlers, styles, scripts, object/embed, forms, and unknown tags.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "span",
  "div",
  "small",
]);

const ALLOWED_ATTRS = new Set(["href", "title", "alt"]);

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function isAllowedUrl(href: string): boolean {
  if (href.startsWith("#")) return true;
  if (href.startsWith("/")) return true;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sanitize a raw HTML string to a strict allowlist of safe tags and attributes.
 * Returns an empty string for non-string input.
 */
export function sanitizeHtml(html: unknown): string {
  if (typeof html !== "string") return "";
  let out = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const tagStack: string[] = [];

  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(html)) !== null) {
    const [fullMatch, slash, tagName, rawAttrs] = match;
    const lowerTag = tagName.toLowerCase();
    const isAllowed = ALLOWED_TAGS.has(lowerTag);
    const isVoid = VOID_TAGS.has(lowerTag);

    // Emit any text between the previous tag and this one, escaped.
    out += escapeHtmlText(html.slice(lastIndex, match.index));

    if (!isAllowed) {
      // Drop disallowed tags entirely, but keep their text content.
      // We skip the tag; text will be emitted next iteration.
    } else if (slash) {
      // Closing tag: only emit if the top of the stack matches.
      if (tagStack.length > 0 && tagStack[tagStack.length - 1] === lowerTag) {
        tagStack.pop();
        out += `</${lowerTag}>`;
      }
    } else {
      let safeAttrs = "";
      if (lowerTag === "a") {
        let href = "";
        let title = "";
        ATTR_RE.lastIndex = 0;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = ATTR_RE.exec(rawAttrs)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
          if (attrName === "href" && isAllowedUrl(attrValue)) {
            href = attrValue;
          } else if (attrName === "title") {
            title = attrValue;
          }
        }
        if (href) {
          safeAttrs += ` href="${escapeHtmlAttr(href)}"`;
          if (title) safeAttrs += ` title="${escapeHtmlAttr(title)}"`;
          safeAttrs += ' rel="noopener noreferrer" target="_blank"';
        }
      } else {
        // For non-anchor tags, only copy alt/title attributes.
        ATTR_RE.lastIndex = 0;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = ATTR_RE.exec(rawAttrs)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
          if (ALLOWED_ATTRS.has(attrName)) {
            safeAttrs += ` ${attrName}="${escapeHtmlAttr(attrValue)}"`;
          }
        }
      }

      if (isVoid) {
        out += `<${lowerTag}${safeAttrs} />`;
      } else {
        tagStack.push(lowerTag);
        out += `<${lowerTag}${safeAttrs}>`;
      }
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Emit remaining text.
  out += escapeHtmlText(html.slice(lastIndex));

  // Close any unclosed allowed tags to keep the DOM balanced.
  while (tagStack.length > 0) {
    out += `</${tagStack.pop()}>`;
  }

  return out;
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
 .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Sanitize a rich content block array, dropping blocks that become empty after
 * sanitization.
 */
export function sanitizeContentBlocks(
  blocks: Array<{ type: string; html: string }> | undefined,
): Array<{ type: "text"; html: string }> | undefined {
  if (!Array.isArray(blocks)) return undefined;
  const sanitized = blocks
    .filter((b) => b && typeof b.html === "string")
    .map((b) => ({ type: "text" as const, html: sanitizeHtml(b.html) }))
    .filter((b) => b.html.length > 0);
  return sanitized.length > 0 ? sanitized : undefined;
}
