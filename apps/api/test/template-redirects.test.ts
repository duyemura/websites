import { describe, it, expect } from "vitest";
import { computeRedirects } from "../src/utils/template/redirects";

const NEW_ROUTES = ["/", "/about", "/pricing", "/contact", "/schedule", "/blog",
  "/blog/top-10-reasons-to-join-a-gym-in-overland-park", "/programs/crossfit-classes", "/local-guide"];

describe("computeRedirects", () => {
  it("skips old paths that still exist", () => {
    const r = computeRedirects(["/about", "/blog"], NEW_ROUTES);
    expect(r).toHaveLength(0);
  });

  it("maps renamed paths by matching last segment", () => {
    const r = computeRedirects(["/programs/crossfit"], NEW_ROUTES.concat("/programs/crossfit"));
    expect(r).toHaveLength(0); // exact exists → no redirect
    const r2 = computeRedirects(["/our-programs/crossfit-classes"], NEW_ROUTES);
    expect(r2).toEqual([{ from: "/our-programs/crossfit-classes", to: "/programs/crossfit-classes", reason: "slug-match" }]);
  });

  it("maps known family prefixes when no slug match exists", () => {
    const r = computeRedirects(["/membership-pricing-request"], NEW_ROUTES);
    expect(r[0].to).toBe("/pricing");
    const r2 = computeRedirects(["/blog/some-deleted-post"], NEW_ROUTES);
    expect(r2[0].to).toBe("/blog");
  });

  it("falls back to homepage for unmatchable orphans, flagged", () => {
    const r = computeRedirects(["/random-old-page"], NEW_ROUTES);
    expect(r).toEqual([{ from: "/random-old-page", to: "/", reason: "fallback" }]);
  });

  it("normalizes trailing slashes before comparing", () => {
    expect(computeRedirects(["/about/"], NEW_ROUTES)).toHaveLength(0);
  });
});
