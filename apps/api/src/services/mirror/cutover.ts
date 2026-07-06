import { promises as dns } from "node:dns";

export type MirrorStatus =
  | "queued"
  | "crawling"
  | "mirrored"
  | "preview_approved"
  | "dns_pending"
  | "dns_verified"
  | "deploying"
  | "live"
  | "failed";

// "retry" maps failed → queued so a broken mirror can be re-enqueued via POST /mirror
export type CutoverEvent = "approve" | "start_cutover" | "dns_verified" | "go_live" | "retry";

const TRANSITIONS: Record<string, Partial<Record<CutoverEvent, MirrorStatus>>> = {
  mirrored: { approve: "preview_approved" },
  preview_approved: { start_cutover: "dns_pending" },
  dns_pending: { dns_verified: "dns_verified" },
  dns_verified: { go_live: "deploying" },
  // failed → queued allows re-running the mirror without manual DB surgery (C3)
  failed: { retry: "queued" },
};

export function nextMirrorStatus(current: string, event: CutoverEvent): MirrorStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

export function generateDnsInstructions(domain: string, cloudfrontDomain: string): string {
  return `# DNS cutover for ${domain}

Make ONLY these two changes at your DNS provider:

1. **www.${domain}** — create/replace a **CNAME** record pointing to \`${cloudfrontDomain}\`
2. **${domain}** (apex/root) — create/replace an **ALIAS** (sometimes called ANAME) record pointing to \`${cloudfrontDomain}\`.
   If your provider does not support ALIAS at the apex, set up apex→www forwarding instead and let us know.

## DO NOT touch anything else. In particular:

- **MX records** — your email stops working if these change.
- **TXT records** (SPF, DKIM, DMARC, verification records) — email deliverability depends on these.
- **Any other subdomain** (e.g. members.${domain}, app.${domain}) — these point at other services you use.

When done, reply here and we will verify propagation before anything goes live. Nothing changes until verification passes.
`;
}

export async function verifyDns(
  domain: string,
  cloudfrontDomain: string,
): Promise<{ wwwOk: boolean; apexOk: boolean }> {
  let wwwOk = false;
  let apexOk = false;

  // www: CNAME check — compare lowercase to handle provider capitalisation differences (I6)
  try {
    const cnames = await dns.resolveCname(`www.${domain}`);
    wwwOk = cnames.some(
      (c) => c.replace(/\.$/, "").toLowerCase() === cloudfrontDomain.toLowerCase(),
    );
  } catch { /* not propagated yet */ }

  // apex: HTTP probe is more reliable than IP comparison for CloudFront ALIAS records (I5)
  // CloudFront sets x-amz-cf-id on every response regardless of cache state
  try {
    const res = await fetch(`https://${domain}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    apexOk = res.headers.has("x-amz-cf-id");
  } catch { /* DNS not propagated, TLS not ready, or distribution still deploying */ }

  return { wwwOk, apexOk };
}
