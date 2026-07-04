import { z } from "zod";

// ---------- shared primitives ----------
export const BBoxSchema = z.object({
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const PageClassificationSchema = z.enum([
  "structural", "collection-exemplar", "ugc-instance", "boilerplate",
]);

export const CanonicalSectionTagSchema = z.enum([
  "hero", "header", "footer", "cta-band", "content-block", "media-block",
  "feature-grid", "testimonial-band", "location-block", "faq-block",
  "social-proof-band", "steps-band", "schedule", "team", "contact", "unknown",
]);
export type CanonicalSectionTag = z.infer<typeof CanonicalSectionTagSchema>;

// ---------- extract ----------
export const NetworkMediaEntrySchema = z.object({
  url: z.string(),
  contentType: z.string(),
  resourceType: z.enum(["image", "video", "font", "stylesheet"]),
  bytes: z.number().nonnegative(),
});

export const InteractionCaptureSchema = z.object({
  id: z.string(),
  trigger: z.enum(["click", "hover"]),
  selector: z.string(),
  beforeUrl: z.string(),   // S3 screenshot
  afterUrl: z.string(),    // S3 screenshot
  styleDiff: z.array(z.object({
    selector: z.string(),
    property: z.string(),
    before: z.string(),
    after: z.string(),
  })),
  boundingBox: BBoxSchema,
});
export type InteractionCapture = z.infer<typeof InteractionCaptureSchema>;

export const BreakpointDeltaSchema = z.object({
  selector: z.string(),
  property: z.string(),
  at1440: z.string(),
  at768: z.string().optional(),
  at375: z.string().optional(),
});
export type BreakpointDelta = z.infer<typeof BreakpointDeltaSchema>;

export const ExtractPageSchema = z.object({
  path: z.string(),
  media: z.array(NetworkMediaEntrySchema),
  screenshots: z.object({ full1440: z.string(), vp375: z.string(), vp768: z.string() }),
  content: z.object({
    title: z.string(),
    businessName: z.string().optional(),
    headings: z.array(z.object({ level: z.number().int().min(1).max(6), text: z.string() })).default([]),
    navLinks: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
    meta: z.record(z.string(), z.string()).default({}),
    jsonLd: z.array(z.unknown()).default([]),
    iframes: z.array(z.object({ src: z.string(), kind: z.enum(["map", "schedule", "form", "video", "other"]) })).default([]),
    videos: z.array(z.object({ src: z.string(), poster: z.string().optional() })).default([]),
  }),
  interactions: z.array(InteractionCaptureSchema),
  responsive: z.array(BreakpointDeltaSchema),
  pixelSamples: z.array(z.object({ x: z.number(), y: z.number(), hex: z.string() })).default([]),
  computedTheme: z.object({
    bodyBackground: z.string(),
    bodyColor: z.string(),
    headingFont: z.string(),
    bodyFont: z.string(),
    primaryAccent: z.string().nullable(),
    sectionBackgrounds: z.array(z.object({ selector: z.string(), background: z.string() })),
  }).optional(),
  flags: z.object({ needsVisionSegmentation: z.boolean(), isSpa: z.boolean() }),
});

export const ExtractArtifactSchema = z.object({
  url: z.string(),
  extractedAt: z.string(),
  siteMap: z.array(z.object({
    url: z.string(),
    path: z.string(),
    title: z.string(),
    classification: PageClassificationSchema,
    source: z.enum(["sitemap", "nav", "footer", "link-sweep"]),
    status: z.enum(["captured", "skipped"]),
    skipReason: z.string().optional(),
  })),
  css: z.object({
    tokens: z.record(z.string(), z.string()),
    breakpoints: z.array(z.string()),
    animations: z.array(z.object({ name: z.string(), css: z.string() })),
    webFontUrls: z.array(z.string()).default([]),
  }),
  pages: z.array(ExtractPageSchema),
  sourceBaseline: z.object({
    capturedAt: z.string(),
    lighthouse: z.array(z.object({
      path: z.string(), preset: z.enum(["mobile", "desktop"]),
      performance: z.number(), seo: z.number(), accessibility: z.number(), bestPractices: z.number(),
    })),
    axe: z.array(z.object({
      path: z.string(),
      violations: z.array(z.object({ id: z.string(), impact: z.string(), nodes: z.number() })),
    })),
    network: z.array(z.object({
      path: z.string(), totalBytes: z.number(), requestCount: z.number(), imageBytes: z.number(),
    })),
  }),
  usage: z.object({ pagesCaptured: z.number(), screenshotCount: z.number() }),
});
export type ExtractArtifact = z.infer<typeof ExtractArtifactSchema>;
export type ExtractPage = z.infer<typeof ExtractPageSchema>;

// ---------- segment ----------
export const SegmentSectionSchema = z.object({
  id: z.string(),
  tag: CanonicalSectionTagSchema,
  order: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["semantic", "visual-boundary", "vision"]),
  boundingBox: BBoxSchema,
  boundingBox375: BBoxSchema.optional(),
  crops: z.object({ desktop: z.string(), mobile: z.string() }),
  innerText: z.string(),
  headingText: z.string().optional(),
  mediaUrls: z.array(z.string()),
  interactionIds: z.array(z.string()),
  sharedComponentId: z.string().optional(),
  sharedProps: z.record(z.string(), z.string()).optional(),
});
export type SegmentSection = z.infer<typeof SegmentSectionSchema>;

export const SegmentArtifactSchema = z.object({
  siteUuid: z.string(),
  sourceExtractAt: z.string(),
  pages: z.array(z.object({
    path: z.string(),
    sections: z.array(SegmentSectionSchema),
    ladder: z.object({ rung1Count: z.number(), rung2Used: z.boolean(), visionUsed: z.boolean() }),
  })),
  sharedComponents: z.array(z.object({
    id: z.string(),
    tag: CanonicalSectionTagSchema,
    memberSectionIds: z.array(z.string()),
    resolution: z.enum(["normalized", "props"]),
    propFields: z.array(z.string()).optional(),
  })),
});
export type SegmentArtifact = z.infer<typeof SegmentArtifactSchema>;

// ---------- verify ----------
export const CheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  critical: z.boolean(),
  detail: z.string().optional(),
});
export type Check = z.infer<typeof CheckSchema>;

export const ScoreDeltaSchema = z.object({
  clone: z.number(), original: z.number(), delta: z.number(),
});

export const VerifyArtifactSchema = z.object({
  pages: z.array(z.object({
    path: z.string(),
    mechanical: z.object({ passed: z.array(CheckSchema), failed: z.array(CheckSchema) }),
    vision: z.object({ score1440: z.number(), score375: z.number(), differences: z.array(z.string()) }),
  })),
  scores: z.object({
    mechanicalFidelity: z.number(),
    visualFidelity: z.number(),
    masterFidelity: z.number(),
    quality: z.object({
      performance: ScoreDeltaSchema,
      seo: ScoreDeltaSchema,
      accessibility: ScoreDeltaSchema,
    }),
  }),
  improvements: z.array(z.object({
    category: z.enum(["semantics", "performance", "seo", "accessibility", "consistency"]),
    source: z.enum(["build-log", "baseline-diff"]),
    description: z.string(),
    page: z.string().optional(),
  })),
  actionable: z.array(z.object({
    page: z.string(),
    sectionId: z.string().optional(),
    issue: z.string(),
    suggestedStage: z.enum(["extract", "segment", "docgen", "build"]),
  })),
});
export type VerifyArtifact = z.infer<typeof VerifyArtifactSchema>;

export const PIPELINE_STAGES = ["extract", "segment", "docgen", "build", "verify"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
