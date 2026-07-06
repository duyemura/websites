import { z } from "zod";
import { CanonicalSectionTagSchema, BBoxSchema } from "./pipeline-artifacts";

/**
 * SectionContract is a normalized, renderer-ready description of one page section.
 * It is derived from the segment + extract artifacts and the design system, and is
 * meant to be consumed by template components so they do not have to guess layout,
 * spacing, colors, or interactions from screenshots.
 */

export const SectionLayoutArchetypeSchema = z.enum([
  "hero-left",
  "hero-center",
  "hero-right",
  "value-props-row",
  "program-cards-sticky",
  "feature-grid-bento",
  "feature-grid-even",
  "feature-grid-masonry",
  "cta-band",
  "faq-accordion",
  "testimonial-scroll",
  "testimonial-grid",
  "steps-numbered",
  "location-split",
  "content-media",
  "community-band",
  "unknown",
]);
export type SectionLayoutArchetype = z.infer<typeof SectionLayoutArchetypeSchema>;

export const SectionBackgroundSchema = z.object({
  color: z.string().optional(),
  imageUrl: z.string().optional(),
  gradient: z.string().optional(),
});
export type SectionBackground = z.infer<typeof SectionBackgroundSchema>;

export const SectionSpacingSchema = z.object({
  top: z.string(),
  bottom: z.string(),
});
export type SectionSpacing = z.infer<typeof SectionSpacingSchema>;

export const SectionTypographySchema = z.object({
  headline: z
    .object({
      text: z.string(),
      align: z.enum(["left", "center", "right"]).default("center"),
      size: z.string().optional(),
      weight: z.string().optional(),
      transform: z.string().optional(),
      color: z.string().optional(),
    })
    .optional(),
  body: z
    .object({
      color: z.string().optional(),
      size: z.string().optional(),
    })
    .optional(),
});
export type SectionTypography = z.infer<typeof SectionTypographySchema>;

export const SectionInteractionsSchema = z.object({
  accordion: z.boolean().default(false),
  scrollSnap: z.boolean().default(false),
  stickyPanel: z.boolean().default(false),
  hoverEffects: z.boolean().default(false),
});
export type SectionInteractions = z.infer<typeof SectionInteractionsSchema>;

export const KnownIconSchema = z.enum([
  "calendar",
  "calendar-check",
  "calendar-clock",
  "phone",
  "clock",
  "ticket",
  "target",
  "rings",
  "muscle",
  "dollar-tag",
  "nutrition",
  "location",
  "mail",
  "star",
  "none",
]);
export type KnownIcon = z.infer<typeof KnownIconSchema>;

export const ItemBackgroundSchema = z.enum([
  "dark",
  "accent",
  "transparent",
  "image",
]);
export type ItemBackground = z.infer<typeof ItemBackgroundSchema>;

export const SectionItemSchema = z.object({
  id: z.string(),
  position: z
    .object({
      col: z.number().int().min(1).max(12).optional(),
      row: z.string().optional(), // e.g. "1 / span 2"
      alignSelf: z.enum(["start", "end", "stretch", "center"]).optional(),
      offsetY: z.string().optional(), // e.g. "0px", "3rem"
    })
    .default({}),
  background: ItemBackgroundSchema.default("transparent"),
  icon: KnownIconSchema.default("none"),
  imageUrl: z.string().optional(),
  title: z.string(),
  body: z.string().optional(),
  cta: z
    .object({
      label: z.string(),
      href: z.string(),
    })
    .optional(),
});
export type SectionItem = z.infer<typeof SectionItemSchema>;

export const SectionCtaSchema = z.object({
  label: z.string(),
  href: z.string(),
  style: z
    .object({
      background: z.string().optional(),
      color: z.string().optional(),
      radius: z.string().optional(),
      hasIcon: z.boolean().default(false),
    })
    .optional(),
});
export type SectionCta = z.infer<typeof SectionCtaSchema>;

export const SectionMediaSchema = z.object({
  imageUrls: z.array(z.string()).default([]),
  videoUrls: z.array(z.string()).default([]),
});
export type SectionMedia = z.infer<typeof SectionMediaSchema>;

export const SectionContractSchema = z.object({
  id: z.string(),
  pagePath: z.string(),
  tag: CanonicalSectionTagSchema,
  sourceConfidence: z.number().min(0).max(1),
  boundingBox: BBoxSchema,
  layout: z.object({
    archetype: SectionLayoutArchetypeSchema,
    background: SectionBackgroundSchema,
    spacing: SectionSpacingSchema,
    separator: z.enum(["slant-down", "slant-up", "none"]).default("none"),
  }),
  typography: SectionTypographySchema.default({}),
  interactions: SectionInteractionsSchema.default({}),
  items: z.array(SectionItemSchema).default([]),
  cta: SectionCtaSchema.optional(),
  media: SectionMediaSchema.default({ imageUrls: [], videoUrls: [] }),
});
export type SectionContract = z.infer<typeof SectionContractSchema>;

export const ContractPageSchema = z.object({
  path: z.string(),
  slug: z.string(),
  isHomePage: z.boolean().default(false),
  sections: z.array(SectionContractSchema),
});
export type ContractPage = z.infer<typeof ContractPageSchema>;

export const ContractArtifactSchema = z.object({
  siteUuid: z.string(),
  sourceSegmentAt: z.string(),
  pages: z.array(ContractPageSchema),
});
export type ContractArtifact = z.infer<typeof ContractArtifactSchema>;
