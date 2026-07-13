import * as cheerio from "cheerio";

export interface RewriteContext {
  pageUrl: string;
  origin: string;
  /** absolute original asset URL -> local path (e.g. "/_assets/x.css") */
  assetMap: Map<string, string>;
  forms: { formId: string; selector: string }[];
  /** e.g. "/forms/{siteUuid}" — formId appended */
  formEndpointBase: string;
  noindex: boolean;
  /**
   * Paths actually crawled (e.g. "/about", "/schedule"). Absolute links whose
   * pathname is in this set are relativized regardless of origin — handles gyms
   * whose HTML bakes in absolute nav hrefs to a CDN domain that differs from origin.
   */
  knownPaths?: Set<string>;
}

function toAbsolute(url: string, ctx: RewriteContext): string | null {
  try {
    return new URL(url, ctx.pageUrl).toString();
  } catch {
    return null;
  }
}

function mapAsset(url: string, ctx: RewriteContext): string | null {
  const abs = toAbsolute(url, ctx);
  if (!abs) return null;
  const noHash = abs.split("#")[0] ?? abs;
  return ctx.assetMap.get(abs) ?? ctx.assetMap.get(noHash) ?? null;
}

const ASSET_ATTRS: [string, string][] = [
  ["link[href]", "href"],
  ["script[src]", "src"],
  ["img[src]", "src"],
  ["source[src]", "src"],
  ["video[poster]", "poster"],
  ["input[type=image][src]", "src"],
];

export function rewriteHtml(html: string, ctx: RewriteContext): string {
  const $ = cheerio.load(html);

  for (const [selector, attr] of ASSET_ATTRS) {
    $(selector).each((_, el) => {
      const val = $(el).attr(attr);
      if (!val || val.startsWith("data:")) return;
      const mapped = mapAsset(val, ctx);
      if (mapped) $(el).attr(attr, mapped);
    });
  }

  $("img[srcset], source[srcset]").each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (!srcset) return;
    const rewritten = srcset
      .split(",")
      .map((entry) => {
        const parts = entry.trim().split(/\s+/);
        const url = parts[0] ?? "";
        const desc = parts.slice(1);
        const mapped = url ? mapAsset(url, ctx) : null;
        return [mapped ?? url, ...desc].join(" ");
      })
      .join(", ");
    $(el).attr("srcset", rewritten);
  });

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = toAbsolute(href, ctx);
    if (!abs) return;
    const url = new URL(abs);
    const sameOrigin = url.origin === ctx.origin;
    const knownPath = ctx.knownPaths?.has(url.pathname);
    if (sameOrigin || knownPath) {
      $(el).attr("href", url.pathname + url.search + url.hash);
    }
  });

  // Match forms by their document position using .eq() — this is stable
  // and consistent with the positional indices used during crawl. (I3)
  ctx.forms.forEach((form, i) => {
    const el = $("form").eq(i);
    if (!el.length) return;
    el.attr("action", `${ctx.formEndpointBase}/${form.formId}`);
    el.attr("method", "post");
    el.append(
      '<input type="text" name="_hp" value="" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">',
    );
  });

  if (ctx.noindex) {
    $("head").append('<meta name="robots" content="noindex">');
  }

  return $.html();
}
