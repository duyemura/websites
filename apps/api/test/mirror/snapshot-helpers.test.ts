import { describe, it, expect } from "vitest";
import { pathToFileKey } from "../../src/services/mirror/snapshot";

describe("pathToFileKey", () => {
  it("maps routes to static file keys", () => {
    expect(pathToFileKey("/")).toBe("index.html");
    expect(pathToFileKey("/coaches")).toBe("coaches/index.html");
    expect(pathToFileKey("/coaches/")).toBe("coaches/index.html");
    expect(pathToFileKey("/about.html")).toBe("about.html");
  });

  it("strips query strings before building the key", () => {
    expect(pathToFileKey("/coaches?utm=1&ref=fb")).toBe("coaches/index.html");
    expect(pathToFileKey("/?ref=home")).toBe("index.html");
  });

  it("strips fragments before building the key", () => {
    expect(pathToFileKey("/coaches#team")).toBe("coaches/index.html");
  });

  it("handles nested paths", () => {
    expect(pathToFileKey("/blog/post-1")).toBe("blog/post-1/index.html");
    expect(pathToFileKey("/blog/post-1/")).toBe("blog/post-1/index.html");
  });

  it("handles empty and root-only paths", () => {
    expect(pathToFileKey("")).toBe("index.html");
    expect(pathToFileKey("/")).toBe("index.html");
  });

  it("handles double leading slashes", () => {
    expect(pathToFileKey("//coaches")).toBe("coaches/index.html");
  });
});
