import { z } from "zod";

export const AssetConsentSchema = z.object({
  hasIdentifiablePeople: z.boolean().optional(),
  hasConsentForAiGeneration: z.boolean().optional(),
  consentSource: z.enum(["owner_affirmed"]).optional(),
  consentScope: z.array(z.string()).optional(),
  affirmedByUserUuid: z.string().optional(),
  affirmedAt: z.string().optional(),
});

export type AssetConsent = z.infer<typeof AssetConsentSchema>;

export interface AssetWithMetadata {
  uuid: string;
  metadata: unknown;
}

export function readAssetConsent(asset: AssetWithMetadata): AssetConsent | null {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const consent = metadata.consent;
  if (!consent || typeof consent !== "object") return null;
  const parsed = AssetConsentSchema.safeParse(consent);
  return parsed.success ? parsed.data : null;
}

export function canUseAssetForPeopleGeneration(asset: AssetWithMetadata): boolean {
  const consent = readAssetConsent(asset);
  if (!consent?.hasIdentifiablePeople) return true;
  return consent.hasConsentForAiGeneration === true;
}
