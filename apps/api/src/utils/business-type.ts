/**
 * Business-type utilities for the template content pipeline.
 *
 * Maps the business category (extracted by docgen/enrich) to the right
 * terminology, role titles, and content focus so LLM prompts produce
 * language that fits each type of fitness/wellness business — not just "gyms".
 *
 * All functions accept any string and fall back gracefully so they work even
 * when category is missing or unexpected.
 */

// ── Category normalisation ────────────────────────────────────────────────────

/** Normalise a raw business category string to a canonical lowercase form. */
export function normaliseCategory(raw?: string | null): string {
  if (!raw) return "gym";
  return raw.toLowerCase().trim();
}

/** Human-readable business type label (singular, indefinite article ready). */
export function businessTypeLabel(category?: string | null): string {
  const c = normaliseCategory(category);
  if (/yoga/i.test(c))                           return "yoga studio";
  if (/pilates/i.test(c))                        return "Pilates studio";
  if (/barre/i.test(c))                          return "barre studio";
  if (/dance/i.test(c))                          return "dance studio";
  if (/martial.art|karate|jiu.jitsu|bjj|mma|boxing|muay.thai/i.test(c)) return "martial arts gym";
  if (/crossfit|cross.fit/i.test(c))             return "CrossFit box";
  if (/cycling|spin/i.test(c))                   return "cycling studio";
  if (/swim/i.test(c))                           return "swim club";
  if (/climb/i.test(c))                          return "climbing gym";
  if (/personal.train/i.test(c))                 return "personal training studio";
  if (/hiit|bootcamp/i.test(c))                  return "fitness studio";
  if (/wellness|holistic/i.test(c))              return "wellness center";
  if (/physical.therapy|physio/i.test(c))        return "physical therapy clinic";
  if (/cheer|gymnastics/i.test(c))               return "gymnastics gym";
  if (/gym|fitness|strength|conditioning/i.test(c)) return "gym";
  return c; // use as-is if no pattern matches
}

// ── Staff role titles ─────────────────────────────────────────────────────────

/**
 * Primary role title for this business type.
 * Used in prompts, hero subheadings, and wherever staff are mentioned.
 *
 * Examples: yoga studio → "instructor", CrossFit → "coach", dance → "teacher"
 */
export function staffRoleTitle(
  category?: string | null,
  opts: { plural?: boolean } = {},
): string {
  const c = normaliseCategory(category);
  const { plural = false } = opts;

  let singular: string;
  if (/yoga|pilates|barre|meditation/i.test(c))          singular = "instructor";
  else if (/dance|ballet|hip.hop|salsa/i.test(c))        singular = "teacher";
  else if (/martial.art|karate|jiu.jitsu|bjj|mma/i.test(c)) singular = "instructor";
  else if (/boxing|muay.thai/i.test(c))                  singular = "trainer";
  else if (/crossfit|cross.fit|hiit|bootcamp/i.test(c))  singular = "coach";
  else if (/swim/i.test(c))                              singular = "coach";
  else if (/climb/i.test(c))                             singular = "guide";
  else if (/cycling|spin/i.test(c))                      singular = "instructor";
  else if (/personal.train/i.test(c))                    singular = "trainer";
  else if (/physical.therapy|physio/i.test(c))           singular = "therapist";
  else if (/cheer|gymnastics/i.test(c))                  singular = "coach";
  else if (/wellness|holistic/i.test(c))                 singular = "practitioner";
  else                                                   singular = "coach";

  return plural ? `${singular}s` : singular;
}

// ── Content / program focus ───────────────────────────────────────────────────

/**
 * What this business type primarily focuses on — used to keep LLM content
 * on-brand. A yoga studio talks about flexibility and mindfulness; a CrossFit
 * box talks about strength and performance; a dance studio talks about technique.
 */
export interface BusinessContentFocus {
  /** Short descriptor: "strength training", "yoga practice", "dance technique" */
  primaryFocus: string;
  /** What sessions/classes are typically called: "class", "session", "practice" */
  sessionWord: string;
  /** What programmes/plans are called: "program", "course", "class series" */
  programWord: string;
  /** What results/outcomes clients get: "strength", "flexibility", "technique" */
  outcomes: string[];
  /** Blog topic keywords relevant to this business type */
  blogTopics: string[];
}

export function contentFocus(category?: string | null): BusinessContentFocus {
  const c = normaliseCategory(category);

  if (/yoga/i.test(c)) return {
    primaryFocus: "yoga practice",
    sessionWord: "class",
    programWord: "program",
    outcomes: ["flexibility", "mindfulness", "strength", "balance"],
    blogTopics: ["yoga poses", "mindfulness", "breathing techniques", "flexibility", "meditation"],
  };

  if (/pilates/i.test(c)) return {
    primaryFocus: "Pilates method",
    sessionWord: "session",
    programWord: "program",
    outcomes: ["core strength", "posture", "flexibility", "body alignment"],
    blogTopics: ["Pilates exercises", "core strength", "posture", "reformer tips"],
  };

  if (/barre/i.test(c)) return {
    primaryFocus: "barre training",
    sessionWord: "class",
    programWord: "program",
    outcomes: ["lean muscle", "flexibility", "posture", "balance"],
    blogTopics: ["barre technique", "ballet-inspired fitness", "toning", "flexibility"],
  };

  if (/dance|ballet|hip.hop|salsa/i.test(c)) return {
    primaryFocus: "dance technique",
    sessionWord: "class",
    programWord: "course",
    outcomes: ["technique", "performance", "artistry", "confidence"],
    blogTopics: ["dance technique", "choreography", "performance tips", "dance styles", "footwork"],
  };

  if (/martial.art|karate|jiu.jitsu|bjj/i.test(c)) return {
    primaryFocus: "martial arts training",
    sessionWord: "class",
    programWord: "program",
    outcomes: ["self-defence", "discipline", "fitness", "technique"],
    blogTopics: ["martial arts techniques", "self-defence", "discipline", "belt progression"],
  };

  if (/boxing|muay.thai/i.test(c)) return {
    primaryFocus: "boxing and striking",
    sessionWord: "session",
    programWord: "program",
    outcomes: ["striking technique", "fitness", "conditioning", "confidence"],
    blogTopics: ["boxing technique", "combinations", "conditioning", "sparring tips"],
  };

  if (/crossfit|cross.fit/i.test(c)) return {
    primaryFocus: "functional fitness",
    sessionWord: "WOD",
    programWord: "program",
    outcomes: ["strength", "endurance", "power", "community"],
    blogTopics: ["WOD tips", "strength training", "nutrition", "recovery", "programming"],
  };

  if (/hiit|bootcamp/i.test(c)) return {
    primaryFocus: "high-intensity training",
    sessionWord: "class",
    programWord: "program",
    outcomes: ["fat loss", "cardiovascular fitness", "strength", "endurance"],
    blogTopics: ["HIIT workouts", "fat burning", "cardio tips", "interval training"],
  };

  if (/cycling|spin/i.test(c)) return {
    primaryFocus: "indoor cycling",
    sessionWord: "ride",
    programWord: "program",
    outcomes: ["cardiovascular fitness", "leg strength", "endurance", "calorie burn"],
    blogTopics: ["cycling tips", "power output", "cadence", "ride recovery"],
  };

  if (/swim/i.test(c)) return {
    primaryFocus: "swimming",
    sessionWord: "session",
    programWord: "program",
    outcomes: ["technique", "endurance", "full-body fitness", "speed"],
    blogTopics: ["stroke technique", "open water", "swim training", "drills"],
  };

  if (/climb/i.test(c)) return {
    primaryFocus: "rock climbing",
    sessionWord: "session",
    programWord: "course",
    outcomes: ["strength", "technique", "problem-solving", "confidence on the wall"],
    blogTopics: ["climbing technique", "route reading", "grip strength", "bouldering tips"],
  };

  if (/personal.train/i.test(c)) return {
    primaryFocus: "personal training",
    sessionWord: "session",
    programWord: "program",
    outcomes: ["personalised results", "form", "goal achievement", "accountability"],
    blogTopics: ["training tips", "form guidance", "goal setting", "nutrition", "recovery"],
  };

  if (/physical.therapy|physio/i.test(c)) return {
    primaryFocus: "physical therapy",
    sessionWord: "appointment",
    programWord: "treatment plan",
    outcomes: ["pain relief", "mobility", "injury recovery", "long-term health"],
    blogTopics: ["injury prevention", "rehab exercises", "mobility", "pain management"],
  };

  if (/wellness|holistic/i.test(c)) return {
    primaryFocus: "holistic wellness",
    sessionWord: "session",
    programWord: "program",
    outcomes: ["wellbeing", "balance", "mindfulness", "health"],
    blogTopics: ["wellness tips", "mindfulness", "nutrition", "sleep", "stress management"],
  };

  // Default: general gym / strength & conditioning
  return {
    primaryFocus: "strength and conditioning",
    sessionWord: "class",
    programWord: "program",
    outcomes: ["strength", "fitness", "community", "results"],
    blogTopics: ["workout tips", "strength training", "nutrition", "recovery", "gym updates"],
  };
}

// ── Convenience helpers ───────────────────────────────────────────────────────

/** Replace "gym" references in a prompt template with the correct business type. */
export function gymToBusinessType(text: string, category?: string | null): string {
  const label = businessTypeLabel(category);
  const role = staffRoleTitle(category);
  const roles = staffRoleTitle(category, { plural: true });
  return text
    .replace(/\bgym website\b/gi, `${label} website`)
    .replace(/\bgym\b/gi, label)
    .replace(/\bcoaches\b/gi, roles)
    .replace(/\bcoach\b/gi, role);
}
