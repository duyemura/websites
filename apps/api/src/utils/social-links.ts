export interface SocialProfile {
  platform: string;
  url: string;
}

const PLATFORM_HOSTS: Record<string, string> = {
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "tiktok.com": "TikTok",
  "twitter.com": "X",
  "x.com": "X",
  "linkedin.com": "LinkedIn",
  "pinterest.com": "Pinterest",
  "snapchat.com": "Snapchat",
  "reddit.com": "Reddit",
  "threads.net": "Threads",
  "yelp.com": "Yelp",
  "wa.me": "WhatsApp",
  "t.me": "Telegram",
  "discord.com": "Discord",
  "discord.gg": "Discord",
  "twitch.tv": "Twitch",
  "vimeo.com": "Vimeo",
};

export function detectSocialPlatform(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return PLATFORM_HOSTS[host] ?? null;
  } catch {
    return null;
  }
}

function normalizeUrlForDedup(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/^www\./, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function extractSocialProfiles(urls: string[]): SocialProfile[] {
  const seen = new Set<string>();
  const result: SocialProfile[] = [];
  for (const url of urls) {
    const platform = detectSocialPlatform(url);
    if (!platform) continue;
    const key = normalizeUrlForDedup(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ platform, url });
  }
  return result;
}
