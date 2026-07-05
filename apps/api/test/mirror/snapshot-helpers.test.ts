import { describe, it, expect } from "vitest";
import { pathToFileKey } from "../../src/services/mirror/snapshot";

describe("pathToFileKey", () => {
  it("maps routes to static file keys", () => {
    expect(pathToFileKey("/")).toBe("index.html");
    expect(pathToFileKey("/coaches")).toBe("coaches/index.html");
    expect(pathToFileKey("/coaches/")).toBe("coaches/index.html");
    expect(pathToFileKey("/about.html")).toBe("about.html");
  });
});
