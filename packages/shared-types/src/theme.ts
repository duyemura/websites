import { z } from "zod";

export const ThemeTokensSchema = z.object({
  colors: z.object({
    primary: z.string(),
    primaryForeground: z.string(),
    background: z.string(),
    foreground: z.string(),
    muted: z.string(),
    mutedForeground: z.string(),
    border: z.string(),
  }),
  fonts: z.object({
    heading: z.string(),
    body: z.string(),
  }),
  radius: z.string(),
});

export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

export const ThemeSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string().nullable().optional(),
  name: z.string(),
  tokens: ThemeTokensSchema,
  source: z.enum(["system_preset", "user_selected", "ai_generated", "replicated"]),
});

export type Theme = z.infer<typeof ThemeSchema>;
