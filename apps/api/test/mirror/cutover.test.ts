import { describe, it, expect } from "vitest";
import { generateDnsInstructions, nextMirrorStatus } from "../../src/services/mirror/cutover";

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
    expect(nextMirrorStatus("dns_verified", "go_live")).toBe("live");
  });

  it("returns null for illegal transitions", () => {
    expect(nextMirrorStatus("mirrored", "go_live")).toBeNull();
    expect(nextMirrorStatus("live", "approve")).toBeNull();
    expect(nextMirrorStatus("queued", "approve")).toBeNull();
    expect(nextMirrorStatus("dns_pending", "approve")).toBeNull();
  });

  it("returns null for unknown current status", () => {
    expect(nextMirrorStatus("unknown", "approve")).toBeNull();
  });
});
