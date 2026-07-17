import { describe, it, expect } from "vitest";
import {
  inferIframeVariant,
  isAllowedIframeSrc,
  sanitizeSandbox,
  sanitizeAllow,
  sanitizeStyle,
  upgradeToHttps,
  sanitizeIframe,
} from "../iframe-utils.js";

describe("inferIframeVariant", () => {
  it("infers map for Google Maps embeds", () => {
    expect(inferIframeVariant("https://www.google.com/maps/embed?pb=...")).toBe("map");
    expect(inferIframeVariant("https://maps.google.com/maps?q=...")).toBe("map");
  });

  it("infers video for YouTube, Vimeo, and Wistia", () => {
    expect(inferIframeVariant("https://www.youtube.com/embed/abc123")).toBe("video");
    expect(inferIframeVariant("https://player.vimeo.com/video/123456")).toBe("video");
    expect(inferIframeVariant("https://fast.wistia.net/embed/iframe/abc")).toBe("video");
  });

  it("infers schedule for calendly/schedule/booking/calendar patterns", () => {
    expect(inferIframeVariant("https://calendly.com/gym/intro")).toBe("schedule");
    expect(inferIframeVariant("https://app.acuityscheduling.com/schedule.php")).toBe("schedule");
    expect(inferIframeVariant("https://booking.pushpress.com/...")).toBe("schedule");
    expect(inferIframeVariant("https://fitlab.pushpress.com/open/calendar?framed=1")).toBe("schedule");
  });

  it("infers form for typeform/jotform/forms/widget-form patterns", () => {
    expect(inferIframeVariant("https://form.typeform.com/to/abc")).toBe("form");
    expect(inferIframeVariant("https://form.jotform.com/123456")).toBe("form");
    expect(inferIframeVariant("https://forms.gle/abc123")).toBe("form");
    expect(inferIframeVariant("https://api.grow.pushpress.com/widget/form/2JdtcQGgU0sX79Cy5sjt")).toBe("form");
  });

  it("infers review for reputation and testimonial widgets", () => {
    expect(inferIframeVariant("https://widgets.trustpilot.com/reviews/...")).toBe("review");
    expect(
      inferIframeVariant("https://reputationhub.site/reputation/widgets/review_widget/1uZTf3N5tL5JS8cNOdpb"),
    ).toBe("review");
  });

  it("falls back to default for unknown iframe sources", () => {
    expect(inferIframeVariant("https://sidebar.bugherd.com/sidebar/embed_html?apikey=...")).toBe("default");
    expect(inferIframeVariant("https://example.com/widget")).toBe("default");
  });
});

describe("isAllowedIframeSrc", () => {
  it("allows http and https iframe sources", () => {
    expect(isAllowedIframeSrc("https://example.com/widget")).toBe(true);
    expect(isAllowedIframeSrc("http://example.com/widget")).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isAllowedIframeSrc("javascript:alert(1)")).toBe(false);
    expect(isAllowedIframeSrc("data:text/html,<script>...")).toBe(false);
    expect(isAllowedIframeSrc("//example.com/widget")).toBe(false);
    expect(isAllowedIframeSrc("about:blank")).toBe(false);
  });
});

describe("sanitizeSandbox", () => {
  it("passes through safe sandbox tokens", () => {
    expect(sanitizeSandbox("allow-scripts allow-same-origin")).toBe("allow-scripts allow-same-origin");
  });

  it("strips top-navigation tokens", () => {
    expect(sanitizeSandbox("allow-scripts allow-top-navigation")).toBe("allow-scripts");
    expect(
      sanitizeSandbox("allow-scripts allow-top-navigation-by-user-activation allow-same-origin"),
    ).toBe("allow-scripts allow-same-origin");
  });

  it("returns undefined when all tokens are dangerous", () => {
    expect(sanitizeSandbox("allow-top-navigation allow-top-navigation-by-user-activation")).toBeUndefined();
  });

  it("returns undefined for empty/undefined input", () => {
    expect(sanitizeSandbox(undefined)).toBeUndefined();
    expect(sanitizeSandbox("")).toBeUndefined();
  });
});

describe("sanitizeAllow", () => {
  it("keeps safe feature policies", () => {
    expect(sanitizeAllow("autoplay; fullscreen")).toBe("autoplay; fullscreen");
    expect(sanitizeAllow("encrypted-media, picture-in-picture")).toBe("encrypted-media; picture-in-picture");
  });

  it("drops dangerous permissions", () => {
    expect(sanitizeAllow("camera; microphone; geolocation; autoplay")).toBe("autoplay");
  });

  it("deduplicates tokens", () => {
    expect(sanitizeAllow("autoplay; autoplay; fullscreen")).toBe("autoplay; fullscreen");
  });

  it("returns undefined for empty/undefined input", () => {
    expect(sanitizeAllow(undefined)).toBeUndefined();
    expect(sanitizeAllow("")).toBeUndefined();
  });
});

describe("sanitizeStyle", () => {
  it("keeps safe sizing properties", () => {
    expect(sanitizeStyle("width: 100%; height: 600px;")).toBe("width: 100%; height: 600px");
  });

  it("drops url-based values that could exfiltrate data", () => {
    expect(sanitizeStyle("background-image: url(https://attacker.example/log?x=1); width: 100%")).toBe(
      "width: 100%",
    );
  });

  it("drops unsafe CSS properties", () => {
    expect(sanitizeStyle("position: fixed; top: 0; width: 100%")).toBe("width: 100%");
  });

  it("returns undefined when no safe declarations remain", () => {
    expect(sanitizeStyle("position: fixed; z-index: 9999")).toBeUndefined();
  });
});

describe("upgradeToHttps", () => {
  it("upgrades http to https", () => {
    expect(upgradeToHttps("http://example.com/widget")).toBe("https://example.com/widget");
  });

  it("leaves https unchanged", () => {
    expect(upgradeToHttps("https://example.com/widget")).toBe("https://example.com/widget");
  });
});

describe("sanitizeIframe", () => {
  it("applies all safety transforms to an embed", () => {
    const embed = sanitizeIframe({
      src: "http://example.com/widget",
      sandbox: "allow-scripts allow-top-navigation",
      allow: "camera; autoplay",
      style: "width: 100%; background-image: url(https://evil.example/log);",
      title: "Widget",
    });
    expect(embed.src).toBe("https://example.com/widget");
    expect(embed.sandbox).toBe("allow-scripts");
    expect(embed.allow).toBe("autoplay");
    expect(embed.style).toBe("width: 100%");
    expect(embed.title).toBe("Widget");
  });

  it("passes through safe embeds unchanged apart from https upgrade", () => {
    const embed = sanitizeIframe({
      src: "https://example.com/widget",
      sandbox: "allow-scripts allow-same-origin",
      allow: "autoplay; fullscreen",
      style: "width: 100%; height: 600px;",
    });
    expect(embed.src).toBe("https://example.com/widget");
    expect(embed.sandbox).toBe("allow-scripts allow-same-origin");
    expect(embed.allow).toBe("autoplay; fullscreen");
    expect(embed.style).toBe("width: 100%; height: 600px");
  });
});
