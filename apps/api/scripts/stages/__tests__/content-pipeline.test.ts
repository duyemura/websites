/**
 * Tests for pure functions in the content pipeline stages.
 * These functions have no side effects and don't need DB/S3/LLM.
 *
 * Coverage:
 *   - classifyPageType: path → page type
 *   - extractJsonObject: extract first valid JSON object from LLM response
 *   - normalizeBrief: guarantee PageBrief shape regardless of LLM output quality
 *   - mergeBriefs: merge per-page briefs preserving existing paths
 */
import { describe, test, expect } from "vitest";
import {
  classifyPageType,
  extractJsonObject,
  normalizeBrief,
  mergeBriefs,
  type PageBrief,
} from "../content";

// ── classifyPageType ──────────────────────────────────────────────────────────

describe("classifyPageType", () => {
  test("root paths → home", () => {
    expect(classifyPageType("/")).toBe("home");
    expect(classifyPageType("")).toBe("home");
  });

  test("program paths", () => {
    expect(classifyPageType("/programs/crossfit")).toBe("program");
    expect(classifyPageType("/classes/bootcamp")).toBe("program");
    expect(classifyPageType("/crossfit-classes")).toBe("program");
    expect(classifyPageType("/bootcamp")).toBe("program");
    expect(classifyPageType("/personal-training")).toBe("program");
  });

  test("about paths", () => {
    expect(classifyPageType("/about")).toBe("about");
    expect(classifyPageType("/about-us")).toBe("about");
    expect(classifyPageType("/our-story")).toBe("other"); // no "about" substring
  });

  test("contact paths", () => {
    expect(classifyPageType("/contact")).toBe("contact");
    expect(classifyPageType("/contact-us")).toBe("contact");
  });

  test("pricing paths", () => {
    expect(classifyPageType("/pricing")).toBe("pricing");
    expect(classifyPageType("/membership")).toBe("pricing");
    expect(classifyPageType("/membership-pricing")).toBe("pricing");
    expect(classifyPageType("/rates")).toBe("pricing");
    expect(classifyPageType("/membership-cancellation")).toBe("pricing");
    expect(classifyPageType("/membership-hold")).toBe("pricing");
  });

  test("schedule paths", () => {
    expect(classifyPageType("/schedule")).toBe("schedule");
    expect(classifyPageType("/class-schedule")).toBe("schedule");
  });

  test("other paths — blog, legal, utility", () => {
    expect(classifyPageType("/blog")).toBe("other");
    expect(classifyPageType("/nutrition")).toBe("other");
    expect(classifyPageType("/privacy-policy")).toBe("other");
    expect(classifyPageType("/terms-of-use")).toBe("other");
    expect(classifyPageType("/search")).toBe("other");
    expect(classifyPageType("/testimonial-slider")).toBe("other");
    expect(classifyPageType("/torrance-local-guide")).toBe("other");
  });
});

// ── extractJsonObject ─────────────────────────────────────────────────────────
// Extracts first valid JSON object from LLM text (handles prose wrapping).

describe("extractJsonObject", () => {
  test("extracts bare JSON", () => {
    const json = '{"hero": {"headline": "Crush Your Goals"}}';
    expect(extractJsonObject(json)).toBe(json);
  });

  test("extracts JSON wrapped in prose (LLM often adds explanation)", () => {
    const raw = `Here is the content brief:\n\n{"hero": {"headline": "Train Hard"}}\n\nLet me know if you need changes.`;
    expect(extractJsonObject(raw)).toBe('{"hero": {"headline": "Train Hard"}}');
  });

  test("handles nested objects correctly", () => {
    const raw = '{"a": {"b": {"c": 1}}, "d": [1, 2]}';
    const result = extractJsonObject(raw);
    expect(result).toBe(raw);
    expect(JSON.parse(result!)).toEqual({ a: { b: { c: 1 } }, d: [1, 2] });
  });

  test("handles escaped quotes inside strings", () => {
    const raw = '{"headline": "She said \\"come train\\""}';
    const result = extractJsonObject(raw);
    expect(result).toBe(raw);
  });

  test("returns undefined for no JSON", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
    expect(extractJsonObject("")).toBeUndefined();
  });

  test("returns first JSON object when multiple present", () => {
    const raw = '{"first": 1} {"second": 2}';
    expect(extractJsonObject(raw)).toBe('{"first": 1}');
  });

  test("returns undefined for unclosed JSON", () => {
    expect(extractJsonObject('{"unclosed": true')).toBeUndefined();
  });
});

// ── normalizeBrief ────────────────────────────────────────────────────────────
// Guarantees the PageBrief shape is always complete regardless of LLM output.
// Critical: the template assumes every field exists — undefined crashes builds.

describe("normalizeBrief", () => {
  test("null/undefined input produces safe defaults — template never crashes", () => {
    const brief = normalizeBrief(null, "/", "home");
    expect(brief.path).toBe("/");
    expect(brief.pageType).toBe("home");
    expect(brief.purpose).toBe("");
    expect(brief.visitorRole).toBe("conversion"); // safe default
    expect(brief.contentFound.hero.headline).toBeNull();
    expect(brief.contentFound.valueProps).toEqual([]);
    expect(brief.contentFound.testimonials).toEqual([]);
    expect(brief.contentFound.faq).toEqual([]);
    expect(brief.contentFound.team).toEqual([]);
    expect(brief.contentFound.plans).toEqual([]);
    expect(brief.contentFound.whoIsItFor).toEqual([]);
    expect(brief.contentFound.phone).toBeNull();
    expect(brief.contentFound.body).toBe("");
  });

  test("good LLM output passes through correctly", () => {
    const raw = {
      purpose: "Convert visitors to members",
      visitorRole: "conversion",
      sectionsNeeded: ["hero", "testimonials"],
      contentFound: {
        hero: { headline: "Get Fit Today", subheading: "Best gym in town", ctaLabel: "Join Now" },
        body: "Full page text here.",
        testimonials: [{ quote: "Amazing!", name: "John D.", program: "CrossFit" }],
        valueProps: [{ headline: "Expert Coaching", body: "Certified trainers." }],
        faq: [{ question: "Do you offer trials?", answer: "Yes, free first class." }],
      },
      contentMissing: ["pricing"],
      generationHint: "Use member testimonials prominently.",
    };
    const brief = normalizeBrief(raw, "/", "home");
    expect(brief.purpose).toBe("Convert visitors to members");
    expect(brief.visitorRole).toBe("conversion");
    expect(brief.contentFound.hero.headline).toBe("Get Fit Today");
    expect(brief.contentFound.hero.ctaLabel).toBe("Join Now");
    expect(brief.contentFound.testimonials).toHaveLength(1);
    expect(brief.contentFound.testimonials[0].program).toBe("CrossFit");
    expect(brief.contentFound.valueProps).toHaveLength(1);
    expect(brief.contentFound.faq[0].question).toBe("Do you offer trials?");
    expect(brief.contentMissing).toEqual(["pricing"]);
  });

  test("invalid visitorRole defaults to 'conversion'", () => {
    expect(normalizeBrief({ visitorRole: "invalid" }, "/", "home").visitorRole).toBe("conversion");
    expect(normalizeBrief({ visitorRole: "" }, "/", "home").visitorRole).toBe("conversion");
    expect(normalizeBrief({ visitorRole: "awareness" }, "/", "home").visitorRole).toBe("awareness");
  });

  test("empty string scalar fields become null (not empty string)", () => {
    const raw = { contentFound: { hero: { headline: "", subheading: "" }, phone: "", city: "" } };
    const brief = normalizeBrief(raw, "/contact", "contact");
    expect(brief.contentFound.hero.headline).toBeNull();   // "" → null
    expect(brief.contentFound.hero.subheading).toBeNull(); // "" → null
    expect(brief.contentFound.phone).toBeNull();            // "" → null
    expect(brief.contentFound.city).toBeNull();             // "" → null
  });

  test("non-array fields where arrays are expected become empty arrays", () => {
    const raw = { contentFound: { valueProps: "not an array", testimonials: null, faq: 42 } };
    const brief = normalizeBrief(raw, "/", "home");
    expect(brief.contentFound.valueProps).toEqual([]);
    expect(brief.contentFound.testimonials).toEqual([]);
    expect(brief.contentFound.faq).toEqual([]);
  });

  test("sectionsNeeded falls back to page-type defaults when missing", () => {
    const homeBrief = normalizeBrief({}, "/", "home");
    expect(homeBrief.sectionsNeeded).toEqual(["hero", "value-props", "programs-preview", "testimonials", "cta"]);
    const aboutBrief = normalizeBrief({}, "/about", "about");
    expect(aboutBrief.sectionsNeeded).toEqual(["hero", "gym-story", "team", "values", "cta"]);
    const programBrief = normalizeBrief({}, "/crossfit", "program");
    expect(programBrief.sectionsNeeded).toEqual(["hero", "description", "who-is-it-for", "schedule-or-pricing", "testimonials", "cta"]);
  });

  test("plan features always an array even when malformed", () => {
    const raw = { contentFound: { plans: [{ name: "Basic", price: "$99", features: "string-not-array" }] } };
    const brief = normalizeBrief(raw, "/pricing", "pricing");
    expect(brief.contentFound.plans[0].features).toEqual([]);
  });

  test("path and pageType always set from params, not LLM output", () => {
    const raw = { path: "/wrong", pageType: "wrong" };
    const brief = normalizeBrief(raw, "/about", "about");
    expect(brief.path).toBe("/about");      // from param, not LLM
    expect(brief.pageType).toBe("about");   // from param, not LLM
  });
});

// ── mergeBriefs ───────────────────────────────────────────────────────────────

function makeBrief(path: string, headline: string): PageBrief {
  return {
    path,
    pageType: "other",
    purpose: "",
    visitorRole: "conversion",
    sectionsNeeded: [],
    contentFound: {
      hero: { headline, subheading: null, ctaLabel: null },
      body: "", cta: null, valueProps: [], testimonials: [], faq: [],
      communityHeadline: null, trustHeadline: null, shortDescription: null,
      whoIsItFor: [], whatMakesUsDifferent: [], gymStory: null, team: [],
      phone: null, email: null, address: null, city: null, state: null,
      zip: null, hours: null, plans: [],
    },
    contentMissing: [],
    generationHint: "",
  };
}

describe("mergeBriefs", () => {
  test("adds a new brief without touching existing ones", () => {
    const existing = [makeBrief("/", "Home"), makeBrief("/about", "About")];
    const result = mergeBriefs(existing, [makeBrief("/contact", "Contact")]);
    expect(result).toHaveLength(3);
    expect(result.map(b => b.path)).toEqual(expect.arrayContaining(["/", "/about", "/contact"]));
  });

  test("replaces an existing brief at the same path", () => {
    const existing = [makeBrief("/about", "Old headline")];
    const result = mergeBriefs(existing, [makeBrief("/about", "New headline")]);
    expect(result).toHaveLength(1);
    expect(result[0].contentFound.hero.headline).toBe("New headline");
  });

  test("empty incoming returns existing unchanged", () => {
    const existing = [makeBrief("/", "Home")];
    expect(mergeBriefs(existing, [])).toEqual(existing);
  });

  test("empty existing returns incoming", () => {
    const incoming = [makeBrief("/", "Home")];
    expect(mergeBriefs([], incoming)).toEqual(incoming);
  });
});
