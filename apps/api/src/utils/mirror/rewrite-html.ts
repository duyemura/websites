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
    if (url.origin === ctx.origin) {
      $(el).attr("href", url.pathname + url.search + url.hash);
    }
  });

  let formIndex = 0;
  $("form").each((_, el) => {
    const form = ctx.forms[formIndex];
    formIndex += 1;
    if (!form) return;
    $(el).attr("action", `${ctx.formEndpointBase}/${form.formId}`);
    $(el).attr("method", "post");
    $(el).append(
      '<input type="text" name="_hp" value="" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">',
    );
  });

  if (ctx.noindex) {
    $("head").append('<meta name="robots" content="noindex">');
  }

  return $.html();
}
