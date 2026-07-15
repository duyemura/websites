// apps/api/src/services/mirror/cloudfront.ts
// CloudFront invalidation helpers for Milo preview + production distributions.

import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { fromIni } from "@aws-sdk/credential-provider-ini";

export interface CloudFrontClientInput {
  region?: string;
  profile?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export type CloudFrontConfig = {
  S3_REGION: string;
  CLOUDFRONT_PROFILE?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_SESSION_TOKEN?: string;
};

/**
 * Build a CloudFront client using the configured profile (default: unicorn).
 * Falls back to explicit env-var credentials, then the default AWS credential
 * chain. Milo CloudFront resources require the unicorn profile; the S3 env
 * credentials do not have CloudFront permissions.
 */
export async function getCloudFrontClient(
  input: CloudFrontClientInput = {},
): Promise<CloudFrontClient> {
  const region = input.region ?? "us-east-1";
  const profile = input.profile ?? "unicorn";

  // Prefer the named profile because Milo CloudFront resources are owned by the
  // unicorn AWS account. fromIni throws if the profile is missing, so we fall
  // back gracefully.
  try {
    const credentials = await fromIni({ profile })();
    return new CloudFrontClient({ region, credentials });
  } catch {
    // fall through
  }

  if (input.accessKeyId && input.secretAccessKey) {
    return new CloudFrontClient({
      region,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
      },
    });
  }

  return new CloudFrontClient({ region });
}

export function cloudFrontClientInputFromConfig(config: CloudFrontConfig): CloudFrontClientInput {
  return {
    region: config.S3_REGION,
    profile: config.CLOUDFRONT_PROFILE,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    sessionToken: config.S3_SESSION_TOKEN,
  };
}

/**
 * Invalidate the preview distribution cache for a site after a template deploy.
 * Failures are logged and surfaced as a warning; a stale preview is not acceptable.
 */
export async function invalidatePreviewCache(
  distributionId: string | undefined,
  config: CloudFrontConfig,
  callerReference?: string,
): Promise<string | null> {
  if (!distributionId) return null;
  try {
    const cf = await getCloudFrontClient(cloudFrontClientInputFromConfig(config));
    const result = await cf.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: callerReference ?? `deploy-template-${Date.now()}-${crypto.randomUUID()}`,
          Paths: { Quantity: 1, Items: ["/*"] },
        },
      }),
    );
    return result.Invalidation?.Id ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[cloudfront] preview invalidation failed: ${message}`);
    return null;
  }
}
