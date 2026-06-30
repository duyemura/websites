import { describe, test, expect } from "vitest";
import { detectSocialPlatform, extractSocialProfiles } from "../../src/utils/social-links";

describe("detectSocialPlatform", () => {
  test("identifies common social platforms", () => {
    expect(detectSocialPlatform("https://www.instagram.com/betagym")).toBe("Instagram");
    expect(detectSocialPlatform("https://facebook.com/betagym")).toBe("Facebook");
    expect(detectSocialPlatform("https://www.youtube.com/@betagym")).toBe("YouTube");
    expect(detectSocialPlatform("https://youtu.be/abc123")).toBe("YouTube");
    expect(detectSocialPlatform("https://tiktok.com/@betagym")).toBe("TikTok");
    expect(detectSocialPlatform("https://x.com/betagym")).toBe("X");
    expect(detectSocialPlatform("https://twitter.com/betagym")).toBe("X");
    expect(detectSocialPlatform("https://www.linkedin.com/company/betagym")).toBe("LinkedIn");
    expect(detectSocialPlatform("https://pinterest.com/betagym")).toBe("Pinterest");
    expect(detectSocialPlatform("https://www.snapchat.com/add/betagym")).toBe("Snapchat");
    expect(detectSocialPlatform("https://reddit.com/r/betagym")).toBe("Reddit");
    expect(detectSocialPlatform("https://threads.net/@betagym")).toBe("Threads");
    expect(detectSocialPlatform("https://www.yelp.com/biz/betagym")).toBe("Yelp");
    expect(detectSocialPlatform("https://wa.me/15551234")).toBe("WhatsApp");
    expect(detectSocialPlatform("https://t.me/betagym")).toBe("Telegram");
    expect(detectSocialPlatform("https://discord.gg/betagym")).toBe("Discord");
    expect(detectSocialPlatform("https://www.twitch.tv/betagym")).toBe("Twitch");
    expect(detectSocialPlatform("https://vimeo.com/betagym")).toBe("Vimeo");
  });

  test("returns null for non-social or malformed urls", () => {
    expect(detectSocialPlatform("https://example-gym.com/classes")).toBeNull();
    expect(detectSocialPlatform("mailto:hi@example.com")).toBeNull();
    expect(detectSocialPlatform("tel:5551234")).toBeNull();
    expect(detectSocialPlatform("not-a-url")).toBeNull();
  });
});

describe("extractSocialProfiles", () => {
  test("deduplicates and preserves order", () => {
    const urls = [
      "https://instagram.com/betagym",
      "https://www.instagram.com/betagym",
      "https://facebook.com/betagym",
      "https://example-gym.com/classes",
    ];
    const profiles = extractSocialProfiles(urls);
    expect(profiles).toEqual([
      { platform: "Instagram", url: "https://instagram.com/betagym" },
      { platform: "Facebook", url: "https://facebook.com/betagym" },
    ]);
  });

  test("normalizes case and trailing slash for dedup", () => {
    const urls = [
      "https://instagram.com/BetaGym",
      "https://www.instagram.com/betagym/",
      "https://instagram.com/betagym",
    ];
    const profiles = extractSocialProfiles(urls);
    expect(profiles).toEqual([{ platform: "Instagram", url: "https://instagram.com/BetaGym" }]);
  });

  test("skips content and event urls and keeps one profile per platform", () => {
    const urls = [
      "https://instagram.com/p/abc123",
      "https://instagram.com/betagym",
      "https://youtu.be/abc123",
      "https://facebook.com/events/123",
      "https://facebook.com/betagym",
      "https://instagram.com/reels/xyz",
    ];
    const profiles = extractSocialProfiles(urls);
    expect(profiles).toEqual([
      { platform: "Instagram", url: "https://instagram.com/betagym" },
      { platform: "Facebook", url: "https://facebook.com/betagym" },
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(extractSocialProfiles([])).toEqual([]);
  });
});
