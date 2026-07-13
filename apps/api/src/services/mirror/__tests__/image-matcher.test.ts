import { describe, it, expect } from "vitest";
import { buildImageMatcher, makeRoundRobin } from "../image-matcher";
import type { MirrorAsset } from "../../../types/mirror";

function asset(localPath: string, overrides: Partial<MirrorAsset> = {}): MirrorAsset {
  return {
    originalUrl: `https://example.com${localPath}`,
    storageKey: `assets/${localPath}`,
    localPath,
    contentType: "image/jpeg",
    ...overrides,
  };
}

describe("buildImageMatcher", () => {
  it("matches a workout image to a program context", () => {
    const matcher = buildImageMatcher([
      asset("/pizza.jpg", {
        visionTags: ["food", "pizza", "recipe", "cheese"],
        visionDescription: "A close-up of a pizza on a table.",
        visionContexts: ["blog", "nutrition"],
      }),
      asset("/barbell.jpg", {
        visionTags: ["gym", "barbell", "workout", "strength", "people"],
        visionDescription: "Athletes lifting barbells in a gym.",
        visionContexts: ["program", "class"],
      }),
    ]);

    const matched = matcher.match({ query: "Group Strength barbell workout program" });
    expect(matched).toBe("/barbell.jpg");
  });

  it("matches by source section context when vision tags are absent", () => {
    const matcher = buildImageMatcher([
      asset("/random.jpg"),
      asset("/classes.jpg", {
        appearances: [
          {
            originalUrl: "https://example.com/classes.jpg",
            pagePath: "/classes",
            sectionType: "feature-grid",
            sectionHeading: "Group Strength Classes",
            sectionBody: "Small-group barbell sessions for every level.",
          },
        ],
      }),
    ]);

    const matched = matcher.match({ query: "Group Strength class barbell" });
    expect(matched).toBe("/classes.jpg");
  });

  it("returns undefined when no image matches the context", () => {
    const matcher = buildImageMatcher([
      asset("/pizza.jpg", {
        visionTags: ["food", "pizza"],
      }),
    ]);

    const matched = matcher.match({ query: "Group Strength workout" });
    expect(matched).toBeUndefined();
  });

  it("prefers an image from the requested section type", () => {
    const matcher = buildImageMatcher([
      asset("/classes.jpg", {
        appearances: [
          {
            originalUrl: "https://example.com/classes.jpg",
            pagePath: "/classes",
            sectionType: "feature-grid",
            sectionHeading: "Group Strength",
            sectionBody: "Barbell classes.",
          },
        ],
      }),
      asset("/hero.jpg", {
        appearances: [
          {
            originalUrl: "https://example.com/hero.jpg",
            pagePath: "/",
            sectionType: "hero",
            sectionHeading: "Welcome",
            sectionBody: "Best gym in town.",
          },
        ],
      }),
    ]);

    const matched = matcher.match({ query: "strength", preferredSectionType: "feature-grid" });
    expect(matched).toBe("/classes.jpg");
  });

  it("excludes non-photo assets", () => {
    const matcher = buildImageMatcher([
      asset("/logo.svg", { contentType: "image/svg+xml" }),
      asset("/styles.css", { contentType: "text/css" }),
      asset("/workout.jpg", { visionTags: ["workout"] }),
    ]);

    expect(matcher.photos.map((p) => p.localPath)).toEqual(["/workout.jpg"]);
  });

  it("respects the exclude set", () => {
    const matcher = buildImageMatcher([
      asset("/workout.jpg", { visionTags: ["workout", "gym"] }),
      asset("/running.jpg", { visionTags: ["running", "cardio", "gym"] }),
    ]);

    const first = matcher.match({ query: "gym workout cardio" });
    expect(first).toBeOneOf(["/workout.jpg", "/running.jpg"]);

    const second = matcher.match({ query: "gym workout cardio", exclude: new Set([first!]) });
    expect(second).not.toBe(first);
  });

  it("matches food images when the section context is about food", () => {
    const matcher = buildImageMatcher([
      asset("/pizza.jpg", { visionTags: ["food", "pizza", "cheese"] }),
      asset("/salad.jpg", { visionTags: ["food", "salad", "healthy", "nutrition"] }),
      asset("/workout.jpg", { visionTags: ["workout", "gym", "barbell"] }),
    ]);

    const matched = matcher.match({ query: "nutrition counseling healthy eating" });
    expect(matched).toBe("/salad.jpg");
  });

  it("does not match a food image to a workout program context", () => {
    const matcher = buildImageMatcher([
      asset("/pizza.jpg", { visionTags: ["food", "pizza", "cheese"] }),
      asset("/salad.jpg", { visionTags: ["food", "salad", "healthy", "nutrition"] }),
    ]);

    const matched = matcher.match({ query: "Group Strength barbell program" });
    expect(matched).toBeUndefined();
  });

  it("round-robin cycles through photos and reuses when exhausted", () => {
    const next = makeRoundRobin([
      asset("/a.jpg", { visionTags: ["gym"] }),
      asset("/b.jpg", { visionTags: ["workout"] }),
    ]);

    const first = next();
    const second = next();
    const third = next();
    expect([first, second]).toEqual(["/a.jpg", "/b.jpg"]);
    expect(third).toBeOneOf(["/a.jpg", "/b.jpg"]);
  });

  it("round-robin honors the exclude set", () => {
    const next = makeRoundRobin([
      asset("/a.jpg", { visionTags: ["gym"] }),
      asset("/b.jpg", { visionTags: ["workout"] }),
      asset("/c.jpg", { visionTags: ["cardio"] }),
    ]);

    expect(next(new Set(["/a.jpg"]))).toBe("/b.jpg");
    expect(next(new Set(["/a.jpg", "/b.jpg"]))).toBe("/c.jpg");
  });

  it("handles empty asset pools", () => {
    const matcher = buildImageMatcher([]);
    expect(matcher.match({ query: "anything" })).toBeUndefined();
    expect(matcher.photos).toEqual([]);

    const next = makeRoundRobin([]);
    expect(next()).toBeUndefined();
  });
});
