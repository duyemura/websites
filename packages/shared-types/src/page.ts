import { z } from "zod";

export const SiteSectionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "Hero",
    "Text",
    "Plans",
    "ClassSchedule",
    "SiteCardGroup",
    "SiteCard",
    "SiteButton",
    "SiteHeader",
    "SiteFooter",
    "SiteBlock",
    "SiteLocation",
    "SiteReviews",
  ]),
  props: z.record(z.unknown()),
  meta: z
    .object({
      seo: z
        .object({
          sectionId: z.string().optional(),
          ariaLabel: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type SiteSection = z.infer<typeof SiteSectionSchema>;

export const SitePageSchema = z.object({
  uuid: z.string(),
  title: z.string(),
  slug: z.string(),
  isHomePage: z.boolean().default(false),
  metaTitle: z.string().nullable().optional(),
  metaDescription: z.string().nullable().optional(),
  sections: z.array(SiteSectionSchema),
  status: z.enum(["draft", "published", "archived"]),
});

export type SitePage = z.infer<typeof SitePageSchema>;
