import { SiteSectionSchema, ThemeTokensSchema } from "@ploy-gyms/shared-types";
import type { SiteSection, ThemeTokens } from "@ploy-gyms/shared-types";
import type { BrandLogo, HeadingStyle } from "../utils/design-system";
import type { SiteDocMetadata } from "./site-doc-metadata";
import { z } from "zod";

const BrandLogoSchema = z.object({
  type: z.enum(["image", "text"]),
  value: z.string(),
  alt: z.string().optional(),
});

const HeadingStyleSchema = z.object({
  uppercase: z.boolean(),
  bold: z.boolean(),
  condensed: z.boolean().optional(),
});

const NavLinkSchema = z.object({
  label: z.string(),
  href: z.string(),
});

const HomePagePrimaryCtaSchema = z.object({
  label: z.string(),
  href: z.string(),
});

export const DesignSystemV2Schema = z.object({
  version: z.literal("2"),
  siteMetadata: z.object({
    framework: z.literal("astro"),
    mode: z.enum(["replication", "template", "greenfield"]),
    targetUrl: z.string().optional(),
    businessName: z.string().optional(),
    generatedAt: z.string(),
  }),
  global: z.object({
    tokens: ThemeTokensSchema,
    shell: z.object({
      header: SiteSectionSchema.optional(),
      footer: SiteSectionSchema.optional(),
      navLinks: z.array(NavLinkSchema),
    }),
    rules: z.object({
      spacing: z.string().optional(),
      radius: z.string().optional(),
      maxWidth: z.string().optional(),
      grid: z.string().optional(),
      defaultTheme: z.enum(["dark", "light"]).optional(),
    }),
  }),
  business: z.object({
    name: z.string().optional(),
    tagline: z.string().optional(),
  }),
  brand: z.object({
    logo: BrandLogoSchema,
    headingStyle: HeadingStyleSchema,
  }),
  reference: z.object({
    screenshotUrl: z.string().nullable().optional(),
    homePagePrimaryCta: HomePagePrimaryCtaSchema.nullable().optional(),
  }),
});

export interface DesignSystemV2 {
  version: "2";
  siteMetadata: SiteDocMetadata;
  global: {
    tokens: ThemeTokens;
    shell: {
      header?: SiteSection; // SiteHeader only
      footer?: SiteSection; // SiteFooter only
      navLinks: { label: string; href: string }[];
    };
    rules: {
      spacing?: string;
      radius?: string;
      maxWidth?: string;
      grid?: string;
      defaultTheme?: "dark" | "light";
    };
  };
  business: {
    name?: string;
    tagline?: string;
  };
  brand: {
    logo: BrandLogo;
    headingStyle: HeadingStyle;
  };
  reference: {
    screenshotUrl?: string | null;
    /** Homepage primary CTA, reused in the global header. */
    homePagePrimaryCta?: { label: string; href: string } | null;
  };
}
