import { z } from "zod";
import { SiteSectionSchema } from "./page.js";
import { ThemeTokensSchema } from "./theme.js";

export const TemplateShellSourceSchema = z.object({
  type: z.literal("url"),
  url: z.string(),
  scrapedAt: z.string(),
});
export type TemplateShellSource = z.infer<typeof TemplateShellSourceSchema>;

export const TemplateShellPlaceholderSchema = z.object({
  key: z.string(),
  label: z.string(),
  sectionId: z.string(),
  propPath: z.string(),
  originalValue: z.string().optional(),
});
export type TemplateShellPlaceholder = z.infer<typeof TemplateShellPlaceholderSchema>;

export const TemplateShellPageSchema = z.object({
  title: z.string(),
  slug: z.string(),
  isHomePage: z.boolean().default(true),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  sections: z.array(SiteSectionSchema),
});
export type TemplateShellPage = z.infer<typeof TemplateShellPageSchema>;

export const TemplateShellSchema = z.object({
  source: TemplateShellSourceSchema,
  theme: ThemeTokensSchema,
  page: TemplateShellPageSchema,
  placeholders: z.array(TemplateShellPlaceholderSchema),
});
export type TemplateShell = z.infer<typeof TemplateShellSchema>;
