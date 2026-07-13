import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";

/**
 * Invalidate the preview distribution cache for a site after a template deploy.
 * Non-fatal: failure is logged but does not break the deploy.
 */
export async function invalidatePreviewCache(
  distributionId: string | undefined,
  callerReference?: string,
): Promise<void> {
  if (!distributionId) return;
  try {
    const cf = new CloudFrontClient({});
    await cf.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: callerReference ?? `deploy-template-${Date.now()}-${crypto.randomUUID()}`,
          Paths: { Quantity: 1, Items: ["/*"] },
        },
      }),
    );
  } catch {
    // Non-fatal — cache will expire naturally.
  }
}
