import * as cheerio from "cheerio";
import type { SiteTransformRecord } from "../../types/mirror";

export interface ApplyResult {
  html: string;
  /** uuids applied successfully */
  applied: string[];
  /** uuids whose selector matched nothing */
  stale: string[];
}

export function pageGlobMatches(glob: string, pagePath: string): boolean {
  if (glob === "/*") return true;
  if (glob.endsWith("/*")) {
    const prefix = glob.slice(0, -2);
    return pagePath === prefix || pagePath.startsWith(prefix + "/");
  }
  return glob === pagePath;
}

export function applyTransforms(
  html: string,
  pagePath: string,
  transforms: SiteTransformRecord[],
): ApplyResult {
  const $ = cheerio.load(html);
  const applied: string[] = [];
  const stale: string[] = [];

  const relevant = transforms
    .filter((tr) => tr.status === "active")
    .filter((tr) => tr.type !== "page-replace")
    .filter((tr) => pageGlobMatches(tr.pageGlob, pagePath))
    .sort((a, b) => a.ordinal - b.ordinal);

  for (const tr of relevant) {
    const payload = tr.payload as Record<string, unknown>;
    switch (tr.type) {
      case "meta-set": {
        if (typeof payload.title === "string") {
          if ($("head title").length === 0) $("head").append("<title></title>");
          $("head title").text(payload.title);
          applied.push(tr.uuid);
          break;
        }
        const attr = typeof payload.name === "string" ? "name" : "property";
        const key = (payload.name ?? payload.property) as string | undefined;
        if (!key || typeof payload.content !== "string") break;
        // Use attribute filter to avoid selector-injection via unescaped key (I5)
        const existing = $("head meta").filter((_, el) => $(el).attr(attr) === key);
        if (existing.length > 0) {
          existing.attr("content", payload.content);
        } else {
          // Build element with cheerio so attribute values are escaped (C2)
          const meta = $("<meta>").attr(attr, key).attr("content", payload.content);
          $("head").append(meta);
        }
        applied.push(tr.uuid);
        break;
      }
      case "jsonld-inject": {
        const script = $("<script>").attr("type", "application/ld+json");
        // Escape </script> sequences so injected payload can't break out of the tag (C1)
        script.text(JSON.stringify(payload.json).replace(/<\//g, "<\\/"));
        $("head").append(script);
        applied.push(tr.uuid);
        break;
      }
      case "head-inject": {
        if (typeof payload.html === "string") {
          $("head").append(payload.html);
          applied.push(tr.uuid);
        }
        break;
      }
      case "text-replace": {
        const els = tr.selector ? $(tr.selector) : $();
        if (els.length === 0) {
          stale.push(tr.uuid);
          break;
        }
        const find = String(payload.find ?? "");
        const replace = String(payload.replace ?? "");
        let done = false;
        // Walk text nodes directly to preserve child element markup (I4)
        els.each((_, el) => {
          if (done) return;
          $(el)
            .contents()
            .each((__, node) => {
              if (done || node.type !== "text") return;
              const data = (node as { data?: string }).data ?? "";
              if (find && data.includes(find)) {
                (node as { data: string }).data = data.replace(find, replace);
                done = true;
              }
            });
        });
        if (done) applied.push(tr.uuid);
        else stale.push(tr.uuid);
        break;
      }
      case "attr-set": {
        const els = tr.selector ? $(tr.selector) : $();
        if (els.length === 0) {
          stale.push(tr.uuid);
          break;
        }
        els.attr(String(payload.attr), String(payload.value));
        applied.push(tr.uuid);
        break;
      }
      case "form-route": {
        const els = tr.selector ? $(tr.selector) : $("form");
        if (els.length === 0) {
          stale.push(tr.uuid);
          break;
        }
        els.each((_, el) => {
          const original = $(el).attr("action");
          // Preserve original action so the interceptor can do capture+passthrough
          // to external systems (GoHighLevel, Wix, etc.). Skip if already rewritten.
          if (original && !original.startsWith("/api/forms/")) {
            $(el).attr("data-milo-original-action", original);
          }
        });
        els.attr("action", String(payload.action));
        applied.push(tr.uuid);
        break;
      }
    }
  }

  return { html: $.html(), applied, stale };
}
