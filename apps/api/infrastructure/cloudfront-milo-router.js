import cf from "cloudfront";

var LANDING = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>My Gym SEO</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh}.wrap{text-align:center;padding:2rem}h1{font-size:3rem;font-weight:900;letter-spacing:-.02em}p{margin-top:1rem;color:#94a3b8;font-size:1.1rem}</style></head><body><div class=\"wrap\"><h1>My Gym SEO</h1><p>Gym website platform</p></div></body></html>";

var UUID_RE = /^\/sites\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

async function handler(event) {
  var r = event.request;
  var h = r.headers["host"] ? r.headers["host"].value : "";
  var uri = r.uri;
  var prefix = null;

  // Path-based: /sites/{uuid}/... — works for any site without a custom domain
  var pathMatch = uri.match(UUID_RE);
  if (pathMatch) {
    prefix = "sites/" + pathMatch[1];
    uri = uri.slice(("/sites/" + pathMatch[1]).length) || "/";
  }

  // Referer-based: asset requests from a /sites/{uuid}/ page
  if (!prefix) {
    var ref = r.headers["referer"] ? r.headers["referer"].value : "";
    var refMatch = ref.match(UUID_RE);
    if (refMatch) {
      prefix = "sites/" + refMatch[1];
    }
  }

  // Custom-domain KVS lookup
  if (!prefix) {
    try {
      var store = cf.kvs("1306140a-98fa-4501-a47a-aa4c3d4ac5ac");
      prefix = await store.get(h);
    } catch (e) {}
  }

  // No site — serve My Gym SEO landing page
  if (!prefix) {
    return {
      statusCode: 200,
      statusDescription: "OK",
      headers: {
        "content-type": { value: "text/html; charset=utf-8" },
        "cache-control": { value: "public, max-age=3600" }
      },
      body: LANDING
    };
  }

  // Normalize to index.html
  if (uri === "" || uri === "/") {
    uri = "/index.html";
  } else if (uri.endsWith("/")) {
    uri = uri + "index.html";
  } else if (uri.lastIndexOf(".") < uri.lastIndexOf("/")) {
    uri = uri + "/index.html";
  }

  r.uri = "/" + prefix + uri;
  return r;
}
