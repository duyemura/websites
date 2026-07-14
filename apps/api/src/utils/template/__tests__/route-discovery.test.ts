import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileToRoute, walk, discoverRoutes } from "../route-discovery.js";

describe("route-discovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "route-discovery-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("fileToRoute maps index.html paths to routes", () => {
    expect(fileToRoute("index.html")).toBe("/");
    expect(fileToRoute("about/index.html")).toBe("/about");
    expect(fileToRoute("programs/strength/index.html")).toBe("/programs/strength");
    expect(fileToRoute("about.html")).toBeNull();
    expect(fileToRoute("404.html")).toBeNull();
    expect(fileToRoute("_astro/chunk.js")).toBeNull();
  });

  test("walk returns all files recursively", async () => {
    fs.mkdirSync(path.join(tmpDir, "about"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "index.html"), "home");
    fs.writeFileSync(path.join(tmpDir, "about", "index.html"), "about");
    fs.writeFileSync(path.join(tmpDir, "about", "photo.jpg"), "");

    const files = await walk(tmpDir);
    expect(files.length).toBe(3);
    expect(files.some((f) => f.endsWith("index.html"))).toBe(true);
    expect(files.some((f) => f.endsWith("photo.jpg"))).toBe(true);
  });

  test("discoverRoutes returns sorted routes for index.html pages", async () => {
    fs.mkdirSync(path.join(tmpDir, "about"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "programs", "strength"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "_astro"), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, "index.html"), "");
    fs.writeFileSync(path.join(tmpDir, "about", "index.html"), "");
    fs.writeFileSync(path.join(tmpDir, "programs", "index.html"), "");
    fs.writeFileSync(path.join(tmpDir, "programs", "strength", "index.html"), "");
    fs.writeFileSync(path.join(tmpDir, "404.html"), "");
    fs.writeFileSync(path.join(tmpDir, "_astro", "chunk.js"), "");

    const routes = await discoverRoutes(tmpDir);
    expect(routes).toEqual(["/", "/about", "/programs", "/programs/strength"]);
  });

  test("discoverRoutes ignores non-index html files", async () => {
    fs.writeFileSync(path.join(tmpDir, "index.html"), "");
    fs.writeFileSync(path.join(tmpDir, "other.html"), "");

    const routes = await discoverRoutes(tmpDir);
    expect(routes).toEqual(["/"]);
  });
});
