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
        const existing = $(`head meta[${attr}="${key}"]`);
        if (existing.length > 0) {
          existing.attr("content", payload.content);
        } else {
          $("head").append(`<meta ${attr}="${key}" content="${payload.content}">`);
        }
        applied.push(tr.uuid);
        break;
      }
      case "jsonld-inject": {
        const script = $("<script>").attr("type", "application/ld+json");
        script.text(JSON.stringify(payload.json));
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
        els.each((_, el) => {
          if (done) return;
          const text = $(el).text();
          if (find && text.includes(find)) {
            $(el).text(text.replace(find, replace));
            done = true;
          }
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
        els.attr("action", String(payload.action));
        applied.push(tr.uuid);
        break;
      }
    }
  }

  return { html: $.html(), applied, stale };
}
