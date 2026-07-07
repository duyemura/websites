import { describe, test, expect } from "vitest";
import { pathToFileKey, pathToOutlineKey } from "../snapshot";

// ── pathToFileKey ─────────────────────────────────────────────────────────────
// Critical: wrong S3 keys mean 404s in production.

describe("pathToFileKey", () => {
  test("root → index.html", () => {
    expect(pathToFileKey("/")).toBe("index.html");
    expect(pathToFileKey("")).toBe("index.html");
  });

  test("simple path → {slug}/index.html", () => {
    expect(pathToFileKey("/about")).toBe("about/index.html");
    expect(pathToFileKey("/contact")).toBe("contact/index.html");
    expect(pathToFileKey("/pricing")).toBe("pricing/index.html");
  });

  test("nested path → nested/index.html", () => {
    expect(pathToFileKey("/programs/crossfit")).toBe("programs/crossfit/index.html");
    expect(pathToFileKey("/programs/group-strength/torrance")).toBe("programs/group-strength/torrance/index.html");
  });

  test("paths with existing extension pass through unchanged", () => {
    expect(pathToFileKey("/about.html")).toBe("about.html");
    expect(pathToFileKey("/robots.txt")).toBe("robots.txt");
    expect(pathToFileKey("/feed.xml")).toBe("feed.xml");
  });

  test("strips query string and fragment", () => {
    expect(pathToFileKey("/about?utm_source=google")).toBe("about/index.html");
    expect(pathToFileKey("/about#section")).toBe("about/index.html");
    expect(pathToFileKey("/about?q=1#hash")).toBe("about/index.html");
  });

  test("trailing slashes are stripped", () => {
    expect(pathToFileKey("/about/")).toBe("about/index.html");
    expect(pathToFileKey("/programs/crossfit/")).toBe("programs/crossfit/index.html");
  });
});

// ── pathToOutlineKey ──────────────────────────────────────────────────────────
// Must always differ from pathToFileKey — a collision overwrites the HTML with outline text.

describe("pathToOutlineKey", () => {
  test("root → outline.txt (not index.html — keys never collide)", () => {
    expect(pathToOutlineKey("/")).toBe("outline.txt");
    expect(pathToOutlineKey("")).toBe("outline.txt");
    // Verify it's distinct from pathToFileKey("/" ) = "index.html"
    expect(pathToOutlineKey("/")).not.toBe(pathToFileKey("/"));
  });

  test("simple path → {slug}/outline.txt", () => {
    expect(pathToOutlineKey("/about")).toBe("about/outline.txt");
    expect(pathToOutlineKey("/contact")).toBe("contact/outline.txt");
    // Always distinct from HTML key
    expect(pathToOutlineKey("/about")).not.toBe(pathToFileKey("/about"));
  });

  test("paths with file extensions strip them (avoids collision)", () => {
    // /about.html → about/outline.txt (not about.htmloutline.txt!)
    expect(pathToOutlineKey("/about.html")).toBe("about/outline.txt");
    // Same result as /about — no matter how the original had the extension
    expect(pathToOutlineKey("/about.html")).toBe(pathToOutlineKey("/about"));
  });

  test("nested paths", () => {
    expect(pathToOutlineKey("/programs/crossfit")).toBe("programs/crossfit/outline.txt");
  });

  test("no path ever produces the same key for both HTML and outline", () => {
    const paths = ["/", "/about", "/contact", "/pricing", "/programs/crossfit", "/about.html"];
    for (const p of paths) {
      expect(pathToOutlineKey(p)).not.toBe(pathToFileKey(p));
    }
  });
});
