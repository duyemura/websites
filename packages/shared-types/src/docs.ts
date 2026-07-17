import { z } from "zod";

export const DocSource = z.enum(["manual", "ai_extracted", "imported"]);
export type DocSource = z.infer<typeof DocSource>;

export const DocStatus = z.enum(["active", "archived"]);
export type DocStatus = z.infer<typeof DocStatus>;

export const DocSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  key: z.string(),
  title: z.string(),
  content: z.string().nullable().optional(),
  source: DocSource,
  status: DocStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Doc = z.infer<typeof DocSchema>;

export const ScrapedColorSchema = z.object({
  token: z.string(),
  hex: z.string(),
  role: z.enum([
    "background",
    "surface",
    "text",
    "textMuted",
    "accent",
    "border",
    "button",
    "buttonText",
  ]),
  usage: z.string().optional(),
});
export type ScrapedColor = z.infer<typeof ScrapedColorSchema>;

export const ScrapedFontSchema = z.object({
  family: z.string(),
  role: z.enum(["heading", "body", "button", "nav", "accent"]),
  weights: z.array(z.number().int()).optional(),
  usage: z.string().optional(),
});
export type ScrapedFont = z.infer<typeof ScrapedFontSchema>;

export const ScrapedTextStyleSchema = z.object({
  element: z.string(),
  mobile: z.string().optional(),
  tablet: z.string().optional(),
  desktop: z.string().optional(),
  notes: z.string().optional(),
});
export type ScrapedTextStyle = z.infer<typeof ScrapedTextStyleSchema>;

export const ScrapedImageSchema = z.object({
  assetUuid: z.string().optional(),
  url: z.string(),
  alt: z.string().optional(),
  context: z.enum(["hero", "background", "product", "team", "testimonial", "icon", "logo", "other"]),
  promptKeywords: z.array(z.string()).optional(),
});
export type ScrapedImage = z.infer<typeof ScrapedImageSchema>;

export const ScrapedLayoutRuleSchema = z.object({
  element: z.string(),
  token: z.string().optional(),
  value: z.string(),
});
export type ScrapedLayoutRule = z.infer<typeof ScrapedLayoutRuleSchema>;

export const ScrapedDesignTokenSchema = z.object({
  category: z.enum([
    "spacing",
    "radius",
    "borderWidth",
    "borderStyle",
    "shadow",
    "grid",
    "maxWidth",
    "transition",
    "opacity",
  ]),
  token: z.string().optional(),
  value: z.string(),
  usage: z.string().optional(),
});
export type ScrapedDesignToken = z.infer<typeof ScrapedDesignTokenSchema>;

export const ScrapedBrandInputSchema = z.object({
  businessName: z.string(),
  tagline: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  colors: z.array(ScrapedColorSchema),
  colorStrategy: z.string().optional(),
  pairingRules: z.array(z.string()).optional(),
  contextRules: z.array(z.string()).optional(),
  darkModeBehavior: z.string().optional(),
  fonts: z.array(ScrapedFontSchema),
  typeScale: z.array(ScrapedTextStyleSchema),
  toneKeywords: z.array(z.string()),
  toneExamples: z.array(z.string()),
  imageryStrategy: z.string().optional(),
  imagePlacement: z.array(z.string()).optional(),
  promptKeywords: z.array(z.string()).optional(),
  images: z.array(ScrapedImageSchema),
  layoutRules: z.array(ScrapedLayoutRuleSchema),
  designTokens: z.array(ScrapedDesignTokenSchema).optional(),
  componentPatterns: z.array(z.string()),
  applicationExamples: z.array(z.string()).optional(),
  screenshotUrls: z.array(z.string()).optional(),
});
export type ScrapedBrandInput = z.infer<typeof ScrapedBrandInputSchema>;

export const IcpProfileSchema = z.object({
  name: z.string(),
  summary: z.string(),
  demographics: z.string().optional(),
  psychographics: z.string().optional(),
  jobsToBeDone: z.array(z.string()).default([]),
  commonObjections: z.array(z.string()).default([]),
  entrySignals: z.array(z.string()).default([]),
});
export type IcpProfile = z.infer<typeof IcpProfileSchema>;

export const WorkspaceMemorySchema = z.object({
  businessSnapshot: z.string(),
  positioning: z.string().optional(),
  industry: z.string().optional(),
  offerings: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().nullable().optional(),
      }),
    )
    .default([]),
  targetMember: z.string().optional(),
  targetMembers: z.array(IcpProfileSchema).default([]),
  antiTargetMembers: z.array(IcpProfileSchema).default([]),
  differentiators: z.array(z.string()).default([]),
  brandVoice: z.string().optional(),
  businessPriorities: z.array(z.string()).default([]),
  keyConstraints: z.array(z.string()).default([]),
  stakeholderName: z.string().optional(),
  stakeholderRole: z.string().optional(),
  stakeholderEmail: z.string().optional(),
  stakeholderNotes: z.string().optional(),
  currentGoal: z.string().optional(),
  lockedDecisions: z.array(z.string()).default([]),
  knownBlockers: z.array(z.string()).default([]),
  followUpBacklog: z.array(z.string()).default([]),
  referenceDocKeys: z.array(z.string()).default([]),
});
export type WorkspaceMemory = z.infer<typeof WorkspaceMemorySchema>;

export const SiteMemorySchema = z.object({
  sitePurpose: z.string().optional(),
  sourceUrl: z.string().optional(),
  replicationStatus: z.string().optional(),
  recentEdits: z.array(z.string()).default([]),
  qaIssues: z.array(z.string()).default([]),
  publishState: z.string().optional(),
  followUpBacklog: z.array(z.string()).default([]),
  knownPlaceholders: z.array(z.string()).default([]),
});
export type SiteMemory = z.infer<typeof SiteMemorySchema>;
