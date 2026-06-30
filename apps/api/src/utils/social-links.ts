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
    parsed.pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

const CONTENT_PATHS = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "direct", "share", "r", "accounts",
  "watch", "shorts", "playlist", "embed", "results",
  "i", "intent", "search", "status", "home", "hashtag",
  "events", "groups", "sharer", "marketplace", "login", "messages", "dialog",
  "video", "tag", "music", "discover",
  "feed", "jobs", "posts", "pulse", "learning",
  "pin", "ideas", "shop",
  "comments", "submit", "wiki",
  "directory", "videos", "clips", "dashboard", "settings",
  "channels", "groups-1", "ondemand",
]);

function isLikelyProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") return false;
    const firstSegment = parsed.pathname.split("/")[1];
    if (!firstSegment) return false;
    return !CONTENT_PATHS.has(firstSegment.toLowerCase());
  } catch {
    return false;
  }
}

export function extractSocialProfiles(urls: string[]): SocialProfile[] {
  const seen = new Set<string>();
  const seenPlatforms = new Set<string>();
  const result: SocialProfile[] = [];
  for (const url of urls) {
    const platform = detectSocialPlatform(url);
    if (!platform || !isLikelyProfileUrl(url)) continue;
    if (seenPlatforms.has(platform)) continue;
    const key = normalizeUrlForDedup(url);
    if (seen.has(key)) continue;
    seen.add(key);
    seenPlatforms.add(platform);
    result.push({ platform, url });
  }
  return result;
}
