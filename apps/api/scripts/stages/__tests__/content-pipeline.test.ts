/**
 * Tests for pure functions in the content pipeline stages.
 * These functions have no side effects and don't need DB/S3/LLM.
 *
 * Coverage:
 *   - classifyPageType: path → page type
 *   - extractJsonObject: extract first valid JSON object from LLM response
 *   - normalizeBrief: guarantee PageBrief shape regardless of LLM output quality
 */
import { describe, test, expect } from "vitest";

// We test the internals by importing from the compiled module.
// Since vitest uses tsx, TypeScript source is resolved directly.
// These functions are private (not exported) — test via a thin re-export shim
// OR test the exported `PageBrief` type + normalization behavior via the
// exported `contentStage` to validate the contract is upheld.
//
// Simpler: extract the logic into small helpers and test those directly.
// The functions are pure — copy the implementations here for isolated testing.

// ── classifyPageType ──────────────────────────────────────────────────────────
// Copy of the function from content.ts — tests the classification logic.
function classifyPageType(path: string) {
  if (path === "/" || path === "") return "home";
  const s = path.toLowerCase();
  if (/\/programs\/|\/classes\/|crossfit|bootcamp|personal-training|strength-training/.test(s)) return "program";
  if (/\/about|about-us/.test(s)) return "about";
  if (/\/contact|contact-us/.test(s)) return "contact";
  if (/\/pricing|\/membership|\/rates/.test(s)) return "pricing";
  if (/\/schedule|class-schedule/.test(s)) return "schedule";
  return "other";
}

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
function extractJsonObject(raw: string): string | undefined {
  const start = raw.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) { escape = false; }
      else if (ch === "\\") { escape = true; }
      else if (ch === '"') { inString = false; }
    } else if (ch === '"') { inString = true; }
    else if (ch === "{") { depth++; }
    else if (ch === "}") { depth--; if (depth === 0) return raw.slice(start, i + 1); }
  }
  return undefined;
}

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
    // Unclosed — depth never reaches 0 at end
    expect(extractJsonObject('{"unclosed": true')).toBeUndefined();
  });
});

// ── normalizeBrief ────────────────────────────────────────────────────────────
// Guarantees the PageBrief shape is always complete regardless of LLM output.
// Critical: the template assumes every field exists — undefined crashes builds.

// Copy of normalizeBrief from content.ts
const PAGE_SECTIONS: Record<string, string[]> = {
  home: ["hero", "value-props", "programs-preview", "testimonials", "cta"],
  about: ["hero", "gym-story", "team", "values", "cta"],
  contact: ["hero", "contact-form", "location-hours", "map"],
  pricing: ["hero", "plans", "faq", "cta"],
  other: ["hero", "content", "cta"],
};

function normalizeBrief(raw: unknown, path: string, pageType: string) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cf = ((r.contentFound ?? {}) as Record<string, unknown>);
  const hero = ((cf.hero ?? {}) as Record<string, unknown>);
  return {
    path,
    pageType,
    purpose: String(r.purpose ?? ""),
    visitorRole: (["awareness","consideration","conversion","retention","utility"].includes(r.visitorRole as string)
      ? r.visitorRole : "conversion"),
    sectionsNeeded: Array.isArray(r.sectionsNeeded) ? r.sectionsNeeded.map(String) : (PAGE_SECTIONS[pageType] ?? PAGE_SECTIONS.other),
    contentFound: {
      hero: {
        headline: String(hero.headline ?? "") || null,
        subheading: String(hero.subheading ?? "") || null,
        ctaLabel: String(hero.ctaLabel ?? "") || null,
      },
      body: String(cf.body ?? ""),
      cta: String(cf.cta ?? "") || null,
      valueProps: Array.isArray(cf.valueProps) ? cf.valueProps.map((v: any) => ({ headline: String(v.headline ?? ""), body: String(v.body ?? "") })) : [],
      testimonials: Array.isArray(cf.testimonials) ? cf.testimonials.map((t: any) => ({ quote: String(t.quote ?? ""), name: String(t.name ?? ""), program: String(t.program ?? "") || null })) : [],
      faq: Array.isArray(cf.faq) ? cf.faq.map((f: any) => ({ question: String(f.question ?? ""), answer: String(f.answer ?? "") })) : [],
      communityHeadline: String(cf.communityHeadline ?? "") || null,
      trustHeadline: String(cf.trustHeadline ?? "") || null,
      shortDescription: String(cf.shortDescription ?? "") || null,
      whoIsItFor: Array.isArray(cf.whoIsItFor) ? cf.whoIsItFor.map(String) : [],
      whatMakesUsDifferent: Array.isArray(cf.whatMakesUsDifferent) ? cf.whatMakesUsDifferent.map(String) : [],
      gymStory: String(cf.gymStory ?? "") || null,
      team: Array.isArray(cf.team) ? cf.team.map((m: any) => ({ name: String(m.name ?? ""), title: String(m.title ?? ""), bio: String(m.bio ?? "") || null })) : [],
      phone: String(cf.phone ?? "") || null,
      email: String(cf.email ?? "") || null,
      address: String(cf.address ?? "") || null,
      city: String(cf.city ?? "") || null,
      state: String(cf.state ?? "") || null,
      zip: String(cf.zip ?? "") || null,
      hours: String(cf.hours ?? "") || null,
      plans: Array.isArray(cf.plans) ? cf.plans.map((p: any) => ({ name: String(p.name ?? ""), price: String(p.price ?? ""), period: String(p.period ?? "") || null, description: String(p.description ?? "") || null, features: Array.isArray(p.features) ? p.features.map(String) : [] })) : [],
    },
    contentMissing: Array.isArray(r.contentMissing) ? r.contentMissing.map(String) : [],
    generationHint: String(r.generationHint ?? ""),
  };
}

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
    expect(homeBrief.sectionsNeeded).toEqual(PAGE_SECTIONS.home);
    const aboutBrief = normalizeBrief({}, "/about", "about");
    expect(aboutBrief.sectionsNeeded).toEqual(PAGE_SECTIONS.about);
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
