import { z } from "zod";

export const SiteStatus = z.enum(["draft", "published", "archived"]);
export type SiteStatus = z.infer<typeof SiteStatus>;

export const SiteSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  slug: z.string(),
  name: z.string(),
  subdomain: z.string(),
  customDomain: z.string().nullable().optional(),
  status: SiteStatus,
  themeUuid: z.string(),
  defaultMetaTitle: z.string().nullable().optional(),
  defaultMetaDescription: z.string().nullable().optional(),
});

export type Site = z.infer<typeof SiteSchema>;
