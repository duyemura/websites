import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateDnsInstructions, nextMirrorStatus, verifyDns } from "../../src/services/mirror/cutover";

describe("generateDnsInstructions", () => {
  it("instructs CNAME for www and ALIAS/ANAME for apex, and warns about MX/TXT", () => {
    const md = generateDnsInstructions("torrancetraininglab.com", "d123.cloudfront.net");
    expect(md).toContain("www.torrancetraininglab.com");
    expect(md).toContain("d123.cloudfront.net");
    expect(md).toContain("MX");
    expect(md).toContain("DO NOT");
    expect(md.toLowerCase()).toContain("alias");
  });

  it("includes both apex and www records for the given domain", () => {
    const md = generateDnsInstructions("crossfitgym.com", "d999.cloudfront.net");
    expect(md).toContain("www.crossfitgym.com");
    expect(md).toContain("crossfitgym.com");
    expect(md).toContain("d999.cloudfront.net");
  });
});

describe("nextMirrorStatus (state machine)", () => {
  it("only allows legal transitions", () => {
    expect(nextMirrorStatus("mirrored", "approve")).toBe("preview_approved");
    expect(nextMirrorStatus("preview_approved", "start_cutover")).toBe("dns_pending");
    expect(nextMirrorStatus("dns_pending", "dns_verified")).toBe("dns_verified");
    expect(nextMirrorStatus("dns_verified", "go_live")).toBe("deploying");
    expect(nextMirrorStatus("failed", "retry")).toBe("queued");
  });

  it("returns null for illegal transitions", () => {
    expect(nextMirrorStatus("mirrored", "go_live")).toBeNull();
    expect(nextMirrorStatus("live", "approve")).toBeNull();
    expect(nextMirrorStatus("queued", "approve")).toBeNull();
    expect(nextMirrorStatus("dns_pending", "approve")).toBeNull();
    // Cannot skip steps
    expect(nextMirrorStatus("mirrored", "start_cutover")).toBeNull();
    expect(nextMirrorStatus("dns_verified", "approve")).toBeNull();
  });

  it("returns null for unknown current status", () => {
    expect(nextMirrorStatus("unknown", "approve")).toBeNull();
  });

  it("failed sites can retry via the retry event", () => {
    expect(nextMirrorStatus("failed", "retry")).toBe("queued");
    // but cannot skip directly to cutover steps
    expect(nextMirrorStatus("failed", "approve")).toBeNull();
    expect(nextMirrorStatus("failed", "go_live")).toBeNull();
  });
});

describe("verifyDns", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns wwwOk: true when CNAME matches (case-insensitive)", async () => {
    // Stub dns.resolveCname to return a capitalized result — real providers do this
    const dnsMod = await import("node:dns");
    vi.spyOn(dnsMod.promises, "resolveCname").mockResolvedValue(["D123.CloudFront.Net."]);
    vi.mocked(fetch).mockResolvedValue({
      headers: { has: () => false },
    } as unknown as Response);

    const result = await verifyDns("gym.com", "d123.cloudfront.net");
    expect(result.wwwOk).toBe(true);
  });

  it("returns wwwOk: false when CNAME does not match", async () => {
    const dnsMod = await import("node:dns");
    vi.spyOn(dnsMod.promises, "resolveCname").mockResolvedValue(["other.cloudfront.net"]);
    vi.mocked(fetch).mockResolvedValue({
      headers: { has: () => false },
    } as unknown as Response);

    const result = await verifyDns("gym.com", "d123.cloudfront.net");
    expect(result.wwwOk).toBe(false);
  });

  it("returns wwwOk: false (not throws) when CNAME lookup fails", async () => {
    const dnsMod = await import("node:dns");
    vi.spyOn(dnsMod.promises, "resolveCname").mockRejectedValue(new Error("ENOTFOUND"));
    vi.mocked(fetch).mockResolvedValue({
      headers: { has: () => false },
    } as unknown as Response);

    const result = await verifyDns("gym.com", "d123.cloudfront.net");
    expect(result.wwwOk).toBe(false);
  });

  it("returns apexOk: true when CloudFront header is present on the domain", async () => {
    const dnsMod = await import("node:dns");
    vi.spyOn(dnsMod.promises, "resolveCname").mockResolvedValue([]);
    vi.mocked(fetch).mockResolvedValue({
      headers: { has: (h: string) => h === "x-amz-cf-id" },
    } as unknown as Response);

    const result = await verifyDns("gym.com", "d123.cloudfront.net");
    expect(result.apexOk).toBe(true);
  });

  it("returns apexOk: false (not throws) when fetch fails", async () => {
    const dnsMod = await import("node:dns");
    vi.spyOn(dnsMod.promises, "resolveCname").mockResolvedValue([]);
    vi.mocked(fetch).mockRejectedValue(new Error("Network timeout"));

    const result = await verifyDns("gym.com", "d123.cloudfront.net");
    expect(result.apexOk).toBe(false);
  });
});
