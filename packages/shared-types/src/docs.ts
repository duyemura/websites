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

export const ScrapedBrandInputSchema = z.object({
  businessName: z.string(),
  tagline: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  colors: z.array(ScrapedColorSchema),
  fonts: z.array(ScrapedFontSchema),
  typeScale: z.array(ScrapedTextStyleSchema),
  toneKeywords: z.array(z.string()),
  toneExamples: z.array(z.string()),
  images: z.array(ScrapedImageSchema),
  layoutRules: z.array(ScrapedLayoutRuleSchema),
  componentPatterns: z.array(z.string()),
  screenshotUrls: z.array(z.string()).optional(),
});
export type ScrapedBrandInput = z.infer<typeof ScrapedBrandInputSchema>;
