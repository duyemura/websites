import { promises as dns } from "node:dns";

export type MirrorStatus =
  | "queued"
  | "crawling"
  | "mirrored"
  | "preview_approved"
  | "dns_pending"
  | "dns_verified"
  | "live"
  | "failed";

export type CutoverEvent = "approve" | "start_cutover" | "dns_verified" | "go_live";

const TRANSITIONS: Record<string, Partial<Record<CutoverEvent, MirrorStatus>>> = {
  mirrored: { approve: "preview_approved" },
  preview_approved: { start_cutover: "dns_pending" },
  dns_pending: { dns_verified: "dns_verified" },
  dns_verified: { go_live: "live" },
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
  try {
    const cnames = await dns.resolveCname(`www.${domain}`);
    wwwOk = cnames.some((c) => c.replace(/\.$/, "") === cloudfrontDomain);
  } catch { /* not propagated yet */ }
  try {
    const [apexIps, cfIps] = await Promise.all([
      dns.resolve4(domain),
      dns.resolve4(cloudfrontDomain),
    ]);
    apexOk = apexIps.some((ip) => cfIps.includes(ip));
  } catch { /* not propagated yet */ }
  return { wwwOk, apexOk };
}
