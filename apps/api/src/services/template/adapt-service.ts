import fs from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import type {
  SectionExtractArtifact,
  SectionExtractEntry,
  SectionTextNode,
  AdaptArtifact,
  AdaptedComponent,
} from "../../types/pipeline-artifacts";
import type { ContractArtifact } from "../../types/section-contract";
import { chatCompletion } from "../../ai/llm-client";
import { modelForTask } from "../../ai/model-picker";
import { deriveComponentName } from "../../utils/pipeline/section-grouper";

// ---------------------------------------------------------------------------
// Public input / output
// ---------------------------------------------------------------------------

export interface AdaptStageInput {
  db: Kysely<DB>;
  config: Config;
  siteUuid: string;
  workspaceUuid: string;
  templateName: string;
  repoRoot: string;
  sectionExtract: SectionExtractArtifact;
  contract: ContractArtifact;
}

// ---------------------------------------------------------------------------
// GymSiteContent classification paths the LLM may assign to text nodes.
// Extend as GymSiteContent grows.
// ---------------------------------------------------------------------------

const VALID_CONTENT_PATHS = [
  "business.name",
  "hero.headline",
  "hero.subheading",
  "hero.ctaLabel",
  "hero.ctaUrl",
  "business.primaryCta.label",
  "business.primaryCta.url",
  "business.tagline",
  "business.address.street",
  "business.geo.city",
  "programsHeadline",
  "communityHeadline",
  "howItWorksHeadline",
  "trustHeadline",
  "STATIC",
] as const;

type ContentPath = (typeof VALID_CONTENT_PATHS)[number];

interface ClassifiedTextNode extends SectionTextNode {
  path: ContentPath;
}

// ---------------------------------------------------------------------------
// Webflow / CMS attribute names to strip
// ---------------------------------------------------------------------------

const STRIP_ATTR_PATTERNS: RegExp[] = [
  /^data-w-id$/,
  /^data-wf-/,
  /^data-node-type$/,
  /^data-animation-/,
  /^data-wf-collection$/,
];

const STRIP_TAGS = new Set(["script", "noscript"]);

// ---------------------------------------------------------------------------
// Brand token hex pattern
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /#([0-9a-fA-F]{3,8})\b/g;

// "White-ish" and "Black-ish" hex ranges to exclude from accent detection
function isNeutral(hex: string): boolean {
  const full = hex.length === 3
    ? hex.split("").map((c) => c + c).join("")
    : hex.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (r + g + b) / 3;
  return luminance < 30 || luminance > 225;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runAdaptService(input: AdaptStageInput): Promise<AdaptArtifact> {
  const { templateName, repoRoot, config } = input;

  const componentsDir = path.join(
    repoRoot,
    "apps/renderer/src/components/sections",
    templateName,
  );
  fs.mkdirSync(componentsDir, { recursive: true });

  // Group sections by tag+archetype to pick one exemplar per unique component
  const componentMap = buildComponentMap(input.sectionExtract, input.contract);

  const adaptedComponents: AdaptedComponent[] = [];

  // Build page map as we go: path → component names[]
  const pageMap: Record<string, string[]> = {};
  for (const contractPage of input.contract.pages) {
    pageMap[contractPage.path] = contractPage.sections.map((cs) =>
      deriveComponentName(cs.tag, cs.layout.archetype),
    );
  }

  // Process each unique component (one LLM call per component)
  for (const [key, entry] of componentMap.entries()) {
    const { name, section } = entry;

    try {
      const adapted = await adaptSection({
        name,
        section,
        config,
        componentsDir,
      });
      adaptedComponents.push(adapted);
    } catch (err) {
      console.warn(
        `[adapt] Failed to adapt component "${name}" (${key}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      // Write a safe fallback so the build doesn't break
      const fallback = buildFallbackComponent(name, section);
      fs.writeFileSync(path.join(componentsDir, `${name}.astro`), fallback, "utf8");
      adaptedComponents.push({
        name,
        filePath: `apps/renderer/src/components/sections/${templateName}/${name}.astro`,
        tag: section.tag,
        archetype: section.archetype,
        boundProps: [],
        staticTextCount: section.textNodes.length,
      });
    }
  }

  // Write index.ts — merges adapt-generated components with hand-crafted
  // .astro files already on disk so existing work is never clobbered.
  const indexTs = buildComponentIndex(templateName, adaptedComponents, componentsDir);
  fs.writeFileSync(path.join(componentsDir, "index.ts"), indexTs, "utf8");

  return {
    templateName,
    components: adaptedComponents,
    pageMap,
  };
}

// ---------------------------------------------------------------------------
// Group sections: one exemplar per tag+archetype combination
// ---------------------------------------------------------------------------

interface ComponentEntry {
  name: string;
  section: SectionExtractEntry;
}

function buildComponentMap(
  extract: SectionExtractArtifact,
  contract: ContractArtifact,
): Map<string, ComponentEntry> {
  const map = new Map<string, ComponentEntry>();

  for (const extractPage of extract.pages) {
    const contractPage = contract.pages.find((p) => p.path === extractPage.path);
    if (!contractPage) continue;

    for (const section of extractPage.sections) {
      const key = `${section.tag}::${section.archetype}`;
      if (map.has(key)) continue;

      const name = deriveComponentName(section.tag, section.archetype);
      map.set(key, { name, section });
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Adapt one section → write .astro file
// ---------------------------------------------------------------------------

interface AdaptSectionInput {
  name: string;
  section: SectionExtractEntry;
  config: Config;
  componentsDir: string;
}

async function adaptSection(input: AdaptSectionInput): Promise<AdaptedComponent> {
  const { name, section, config, componentsDir } = input;

  // Step 1: Mechanical HTML transforms (no LLM)
  const cleanedHTML = mechanicalTransform(section.outerHTML);

  // Step 2: Brand token extraction (no LLM)
  const tokenizedHTML = extractBrandTokens(cleanedHTML);

  // Step 3: LLM content classification (one call per section)
  const classifiedNodes = section.textNodes.length > 0
    ? await classifyTextNodes(section.textNodes, config)
    : [];

  // Step 4: Generate Astro component
  const { code, boundProps, staticTextCount } = buildAstroComponent(
    name,
    tokenizedHTML,
    section,
    classifiedNodes,
  );

  const filePath = path.join(componentsDir, `${name}.astro`);
  fs.writeFileSync(filePath, code, "utf8");

  return {
    name,
    filePath: filePath.replace(/^.*apps\/renderer\//, "apps/renderer/"),
    tag: section.tag,
    archetype: section.archetype,
    boundProps,
    staticTextCount,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Mechanical HTML transforms
// ---------------------------------------------------------------------------

function mechanicalTransform(html: string): string {
  // Parse with a simple regex-based transformer — no DOM parser available
  // in Node (we intentionally avoid jsdom to keep dependencies minimal).

  let result = html;

  // Remove <script ...>...</script> blocks
  result = result.replace(/<script[\s\S]*?<\/script>/gi, "");

  // Remove <noscript ...>...</noscript> blocks
  result = result.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Strip Webflow data attributes from opening tags
  result = result.replace(/<([a-zA-Z][^\s>]*)([\s\S]*?)>/g, (_match, tag, attrs) => {
    if (STRIP_TAGS.has(tag.toLowerCase())) return "";
    const cleanedAttrs = stripWebflowAttributes(attrs as string);
    // Sanitize dangerous event handlers and javascript: hrefs
    const safeAttrs = sanitizeAttributes(cleanedAttrs);
    return `<${tag}${safeAttrs}>`;
  });

  return result;
}

function stripWebflowAttributes(attrs: string): string {
  // Split on attribute boundaries and filter
  return attrs.replace(/\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g, (attrExpr) => {
    const nameMatch = /\s+([\w:-]+)/.exec(attrExpr);
    if (!nameMatch) return attrExpr;
    const name = nameMatch[1];
    const shouldStrip = STRIP_ATTR_PATTERNS.some((re) => re.test(name));
    return shouldStrip ? "" : attrExpr;
  });
}

function sanitizeAttributes(attrs: string): string {
  // Remove on* event handlers
  let result = attrs.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
  // Remove javascript: hrefs
  result = result.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  return result;
}

// ---------------------------------------------------------------------------
// Step 2: Brand token extraction
// ---------------------------------------------------------------------------

function extractBrandTokens(html: string): string {
  // Collect all non-neutral hex colors across the HTML
  const colorCounts = new Map<string, number>();
  let match: RegExpExecArray | null;
  const re = new RegExp(HEX_COLOR_RE.source, "gi");
  while ((match = re.exec(html)) !== null) {
    const hex = match[1].toLowerCase();
    if (!isNeutral(hex)) {
      colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
    }
  }

  if (colorCounts.size === 0) return html;

  // Find the most common non-neutral color — treat it as the brand accent
  let accentHex = "";
  let maxCount = 0;
  for (const [hex, count] of colorCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      accentHex = hex;
    }
  }

  if (!accentHex) return html;

  // Replace accent color with CSS custom property
  // Short hex: #abc → normalized to #aabbcc for comparison
  const normalizeHex = (h: string) =>
    h.length === 3 ? h.split("").map((c) => c + c).join("") : h;

  const normalizedAccent = normalizeHex(accentHex);

  let result = html.replace(HEX_COLOR_RE, (_m, hex) => {
    const norm = normalizeHex(hex.toLowerCase());
    if (norm === normalizedAccent) {
      return `var(--modern-accent, #${hex})`;
    }
    return `#${hex}`;
  });

  // Replace font-family references with CSS custom properties
  // heading font heuristic: the first font-family found in a heading context
  result = result.replace(
    /font-family\s*:\s*([^;}"']+)/gi,
    (_m, fontVal: string) => {
      const first = fontVal.split(",")[0].trim().replace(/['"]/g, "");
      if (first.toLowerCase().includes("serif") || first.toLowerCase().includes("display")) {
        return `font-family: var(--modern-font-heading, ${fontVal})`;
      }
      return `font-family: var(--modern-font-body, ${fontVal})`;
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Step 3: LLM content classification
// ---------------------------------------------------------------------------

interface ClassifyResponse {
  classifications: Array<{ text: string; path: string }>;
}

async function classifyTextNodes(
  textNodes: SectionTextNode[],
  config: Config,
): Promise<ClassifiedTextNode[]> {
  // Limit to first 30 text nodes to keep prompt small
  const nodesToClassify = textNodes.slice(0, 30);

  const nodesJson = JSON.stringify(
    nodesToClassify.map((n) => ({ tag: n.tag, text: n.text, className: n.className })),
    null,
    2,
  );

  const prompt = `You are classifying text elements from a gym website section.

For each text element below, return which GymSiteContent field path it should be bound to.

Valid paths:
${VALID_CONTENT_PATHS.map((p) => `- ${p}`).join("\n")}

Use STATIC for any text that is generic placeholder, marketing filler, decorative, or that does not map to a specific gym data field.

Text elements (JSON):
${nodesJson}

Return ONLY valid JSON with this exact shape:
{
  "classifications": [
    { "text": "<exact text>", "path": "<one of the valid paths>" }
  ]
}`;

  const response = await chatCompletion(
    {
      model: modelForTask("cheap", config),
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1000,
      jsonMode: true,
    },
    config,
  );

  let parsed: ClassifyResponse;
  try {
    parsed = JSON.parse(response.content) as ClassifyResponse;
  } catch {
    console.warn("[adapt] LLM returned invalid JSON for text classification; treating all as STATIC");
    return nodesToClassify.map((n) => ({ ...n, path: "STATIC" as ContentPath }));
  }

  // Merge back with original nodes
  const classified: ClassifiedTextNode[] = nodesToClassify.map((node) => {
    const match = parsed.classifications?.find((c) => c.text === node.text);
    const rawPath = match?.path ?? "STATIC";
    const path = (VALID_CONTENT_PATHS as readonly string[]).includes(rawPath)
      ? (rawPath as ContentPath)
      : "STATIC";
    return { ...node, path };
  });

  return classified;
}

// ---------------------------------------------------------------------------
// Step 4: Build Astro component
// ---------------------------------------------------------------------------

interface BuildResult {
  code: string;
  boundProps: string[];
  staticTextCount: number;
}

/** Convert a GymSiteContent path (e.g. "hero.headline") to a camelCase prop name. */
function pathToPropName(contentPath: ContentPath): string {
  if (contentPath === "STATIC") return "";
  return contentPath
    .replace(/\./g, "_")
    .replace(/([_-][a-z])/g, (m) => m.replace(/[_-]/, "").toUpperCase());
}

function buildAstroComponent(
  componentName: string,
  html: string,
  section: SectionExtractEntry,
  classified: ClassifiedTextNode[],
): BuildResult {
  // Collect unique non-STATIC prop names
  const propPaths = new Set<ContentPath>();
  for (const node of classified) {
    if (node.path !== "STATIC") propPaths.add(node.path);
  }
  const boundProps = [...propPaths].map(pathToPropName).filter(Boolean);
  const staticTextCount = classified.filter((n) => n.path === "STATIC").length;

  // Build the Props interface
  const propsInterface = buildPropsInterface(boundProps);

  // Substitute text node content in HTML with {propName} expressions
  let bodyHTML = substituteTextNodes(html, classified);

  // Add data-eval-component attribute to the root element
  bodyHTML = addEvalAttribute(bodyHTML, componentName);

  // Build a scoped style block from the section's key computed CSS
  const styleBlock = buildStyleBlock(componentName, section);

  const code = `---
${propsInterface}
const { ${boundProps.length > 0 ? boundProps.join(", ") : ""} } = Astro.props;
---

${bodyHTML}

${styleBlock}
`;

  return { code, boundProps, staticTextCount };
}

function buildPropsInterface(propNames: string[]): string {
  if (propNames.length === 0) {
    return `export interface Props {}`;
  }
  const fields = propNames.map((p) => `  ${p}?: string;`).join("\n");
  return `export interface Props {\n${fields}\n}`;
}

/**
 * Walk through the HTML and replace classified text node content with
 * Astro prop expressions. This is intentionally conservative — it only
 * replaces the text content of leaf-level elements (no children other
 * than text), leaving all structural HTML untouched.
 */
function substituteTextNodes(html: string, classified: ClassifiedTextNode[]): string {
  let result = html;

  for (const node of classified) {
    if (node.path === "STATIC") continue;

    const propName = pathToPropName(node.path);
    if (!propName) continue;

    // Escape the text for use in a regex
    const escapedText = escapeRegex(node.text);
    // Match the text within an element (non-greedy, between > and <)
    const re = new RegExp(`(>${escapedText}<)`, "g");
    result = result.replace(re, `>{${propName} ?? ${JSON.stringify(node.text)}}<`);
  }

  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Add data-eval-component to the first opening HTML tag in the component. */
function addEvalAttribute(html: string, componentName: string): string {
  return html.replace(/^(\s*<[a-zA-Z][^\s>/]*)/, `$1 data-eval-component="${componentName}"`);
}

/**
 * Build the Astro <style> block for a component.
 *
 * Preferred: use the cssRules extracted by section-extract (all rules whose
 * selectors match elements inside this section, from every stylesheet on the
 * source page — including CDN-hosted ones captured via network interception).
 * Each rule is scoped to [data-eval-component="ComponentName"] so it doesn't
 * bleed into other sections. @font-face and @keyframes are kept global (they
 * must be at the document root to work).
 *
 * Fallback: if cssRules is absent (old artifact), synthesise a minimal style
 * block from the computed root styles.
 *
 * This approach is source-site-agnostic — it works for Webflow, Bootstrap,
 * Tailwind (inline styles), plain CSS, or any other framework.
 */
function buildStyleBlock(componentName: string, section: SectionExtractEntry): string {
  const scope = `[data-eval-component="${componentName}"]`;

  // ── Preferred path: use extracted CSS rules ──────────────────────────────
  if (section.cssRules && section.cssRules.length > 0) {
    const scoped: string[] = [];

    for (const rule of section.cssRules) {
      scoped.push(scopeCSSRule(rule, scope));
    }

    return `<style is:global>\n${scoped.join("\n")}\n</style>`;
  }

  // ── Fallback: synthesise from computed styles on section root ────────────
  const cs = section.computedStyles;
  const decls: string[] = [];

  if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") decls.push(`  background-color: ${cs.backgroundColor};`);
  if (cs.backgroundImage && cs.backgroundImage !== "none")             decls.push(`  background-image: ${cs.backgroundImage};`);
  if (cs.color)                                                          decls.push(`  color: ${cs.color};`);
  if (cs.padding)                                                        decls.push(`  padding: ${cs.padding};`);
  if (cs.display && cs.display !== "block")                              decls.push(`  display: ${cs.display};`);
  if (cs.flexDirection && cs.display === "flex")                         decls.push(`  flex-direction: ${cs.flexDirection};`);
  if (cs.gap)                                                            decls.push(`  gap: ${cs.gap};`);
  if (cs.textAlign && cs.textAlign !== "start")                          decls.push(`  text-align: ${cs.textAlign};`);
  if (cs.alignItems)                                                     decls.push(`  align-items: ${cs.alignItems};`);
  if (cs.justifyContent)                                                 decls.push(`  justify-content: ${cs.justifyContent};`);

  if (decls.length === 0) return "";

  return `<style is:global>\n${scope} {\n${decls.join("\n")}\n}\n</style>`;
}

/**
 * Scope a single CSS rule text to a parent selector.
 *
 * Rules that must stay global (@font-face, @keyframes, @charset, @import)
 * are returned unchanged. Regular style rules and @media/@supports blocks
 * have their selectors prefixed with the scope attribute selector.
 */
function scopeCSSRule(rule: string, scope: string): string {
  const trimmed = rule.trimStart();

  // @font-face and @keyframes must be at document root — don't scope them.
  if (/^@font-face\b/i.test(trimmed) || /^@(-\w+-)?keyframes\b/i.test(trimmed) ||
      /^@charset\b/i.test(trimmed) || /^@import\b/i.test(trimmed)) {
    return rule;
  }

  // @media and @supports — scope the inner style rules recursively.
  const atBlockMatch = trimmed.match(/^@(media|supports)([^{]*)\{([\s\S]*)\}\s*$/i);
  if (atBlockMatch) {
    const atKeyword = atBlockMatch[1] ?? "media";
    const condition = atBlockMatch[2] ?? "";
    const innerBlock = atBlockMatch[3] ?? "";
    const innerScoped = scopeInnerRules(innerBlock, scope);
    return `@${atKeyword}${condition}{\n${innerScoped}\n}`;
  }

  // Regular style rule: scope the selector list.
  const braceIdx = rule.indexOf("{");
  if (braceIdx === -1) return rule;
  const selectorText = rule.slice(0, braceIdx);
  const rest = rule.slice(braceIdx);
  return `${scopeSelectorList(selectorText, scope)}${rest}`;
}

/** Scope a comma-separated selector list. */
function scopeSelectorList(selectors: string, scope: string): string {
  return selectors
    .split(",")
    .map((s) => {
      const t = s.trim();
      if (!t) return "";
      // :root, html, body stay unscoped but constrained to descendant context.
      if (t === ":root" || t === "html" || t === "body") return scope;
      return `${scope} ${t}`;
    })
    .filter(Boolean)
    .join(",\n");
}

/** Scope all style rules found inside a @media/@supports block. */
function scopeInnerRules(block: string, scope: string): string {
  // Match pairs of "selector { declarations }" — handles simple cases.
  // This is intentionally conservative: complex nested CSS (e.g. @layer inside
  // @media) is passed through unchanged to avoid mangling.
  return block.replace(
    /([^{}@]+)\{([^{}]*)\}/g,
    (_, sel: string, decls: string) => `${scopeSelectorList(sel, scope)} {${decls}}`,
  );
}

// ---------------------------------------------------------------------------
// Fallback component when adapt fails
// ---------------------------------------------------------------------------

function buildFallbackComponent(name: string, section: SectionExtractEntry): string {
  return `---
// Fallback: adapt stage failed for ${name} (${section.tag} / ${section.archetype})
export interface Props {}
---

<section data-eval-component="${name}" class="adapt-fallback">
  <!-- Original HTML could not be adapted. Source section: ${section.tag} / ${section.archetype} -->
</section>

<style>
.adapt-fallback {
  padding: 4rem 1.5rem;
}
</style>
`;
}

// ---------------------------------------------------------------------------
// Component index
// ---------------------------------------------------------------------------

function buildComponentIndex(
  templateName: string,
  components: AdaptedComponent[],
  componentsDir: string,
): string {
  // Deduplicate incoming adapt-generated components by name.
  const seen = new Set<string>();
  const uniqueNew = components.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  // Discover ALL .astro files in the components directory so hand-crafted
  // components (Hero, Programs, HowItWorks, etc.) are preserved even when
  // adapt is re-run. Adapt-generated names take precedence for their entries
  // but we never remove existing hand-crafted components from the index.
  const existingFiles = fs.existsSync(componentsDir)
    ? fs.readdirSync(componentsDir)
        .filter((f) => f.endsWith(".astro"))
        .map((f) => f.replace(".astro", ""))
    : [];

  // Merge: start with all disk files, then overlay adapt-generated names
  const allNames = new Set<string>([...existingFiles, ...uniqueNew.map((c) => c.name)]);

  const imports = [...allNames]
    .map((name) => `import ${name} from "./${name}.astro";`)
    .join("\n");
  const entries = [...allNames]
    .map((name) => `  "${name}": ${name} as unknown as AstroComponent,`)
    .join("\n");

  return `// Auto-generated by milo adapt stage — review before shipping.
import type { AstroComponent } from "../../../lib/template-resolver";

${imports}

export const COMPONENT_MAP: Record<string, AstroComponent> = {
${entries}
};
`;
}

// Re-export deriveComponentName so stage runner can use it without importing from section-grouper
export { deriveComponentName } from "../../utils/pipeline/section-grouper";
