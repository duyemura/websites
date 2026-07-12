// apps/api/src/services/template/rendered-audit.ts
// Deterministic rendered-content QA for a generated Milo site.
// Checks every page for the gym's real NAP, placeholder leakage, and valid
// JSON-LD. Only performs deterministic self-heal (no LLM).

import * as cheerio from "cheerio";
import type { GymSiteContent, BusinessInfo } from "@ploy-gyms/shared-types";
import {
  DEFAULT_BUSINESS_NAME,
  DEFAULT_CITY,
  DEFAULT_STATE,
  DEFAULT_STATE_ABBR,
  DEFAULT_BUSINESS_PLACEHOLDER,
} from "@ploy-gyms/shared-types/template-baseline";
import { sanitizeContentCtas } from "./content-mapper.js";
import { sanitizeNavigationLinks } from "./nav-slots.js";

export interface AuditFailure {
  page: string;
  check: string;
  message: string;
  fixable: boolean;
  /** Suggested fix, if known. */
  fix?: string;
}

export interface AuditResult {
  failures: AuditFailure[];
  warnings: string[];
  checkedPages: number;
}

interface PageCheckContext {
  route: string;
  text: string;
  jsonLd: unknown[];
  business: BusinessInfo;
  allowedPaths: Set<string>;
}

const DEFAULT_PLACEHOLDER_STRINGS = [
  DEFAULT_BUSINESS_NAME,
  DEFAULT_CITY,
  DEFAULT_STATE,
  DEFAULT_STATE_ABBR,
  DEFAULT_BUSINESS_PLACEHOLDER.address.street,
  DEFAULT_BUSINESS_PLACEHOLDER.address.zip,
  DEFAULT_BUSINESS_PLACEHOLDER.phone,
  DEFAULT_BUSINESS_PLACEHOLDER.email,
  ...(DEFAULT_BUSINESS_PLACEHOLDER.serviceArea ?? []),
].filter(Boolean);

function isExternalOrAnchor(href: string): boolean {
  return /^(https?:|mailto:|tel:|#|\/\/)/i.test(href);
}

function normalizePath(href: string): string {
  return href.toLowerCase().replace(/\/+$/, "") || "/";
}

function firstSegment(href: string): string {
  return (href.split("#")[0] ?? "").split("?")[0] ?? "";
}

export function buildAllowedPaths(content: GymSiteContent): Set<string> {
  const paths = new Set<string>([
    "/",
    "/about",
    "/contact",
    "/pricing",
    "/schedule",
    "/blog",
    "/local-guide",
    "/programs",
  ]);
  for (const p of content.pages.programs) {
    paths.add(`/programs/${p.slug}`);
  }
  for (const l of content.pages.legal) {
    paths.add(`/legal/${l.slug}`);
  }
  return paths;
}

function extractTextAndJsonLd(html: string): { text: string; jsonLd: unknown[] } {
  const $ = cheerio.load(html);
  // JSON-LD first, before we strip scripts
  const jsonLd: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      jsonLd.push({ __parseError: true, raw });
    }
  });

  // Drop non-visible elements so we only audit content a user would see
  $("script, style, noscript, iframe, [aria-hidden='true']").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { text, jsonLd };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function containsPlaceholder(haystack: string, placeholder: string): boolean {
  // Use word boundaries so short placeholders like "YS" do not match the
  // middle of real words (e.g., "gyms" or "workouts").
  const re = new RegExp(`\\b${escapeRegExp(placeholder)}\\b`, "i");
  return re.test(haystack);
}

function localBusinessObjects(ld: unknown[]): unknown[] {
  return ld.flatMap((obj) => {
    if (!obj || typeof obj !== "object") return [];
    const candidates: unknown[] = [];
    if (Array.isArray((obj as Record<string, unknown>)["@graph"])) {
      candidates.push(...(obj as Record<string, unknown>)["@graph"] as unknown[]);
    } else {
      candidates.push(obj);
    }
    return candidates.filter((c) => {
      if (!c || typeof c !== "object") return false;
      const type = (c as Record<string, unknown>)["@type"];
      const types = Array.isArray(type) ? type : [type];
      return types.some((t) => t === "LocalBusiness" || t === "HealthAndBeautyBusiness" || t === "SportsActivityLocation");
    });
  });
}

function valueString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function checkBusinessInfoPresent(ctx: PageCheckContext): AuditFailure[] {
  const failures: AuditFailure[] = [];
  const { route, text, business } = ctx;

  const hasRealName = business.name && business.name !== DEFAULT_BUSINESS_NAME;
  if (!hasRealName || !containsCaseInsensitive(text, business.name)) {
    failures.push({
      page: route,
      check: "business-name-present",
      message: hasRealName
        ? `Real gym name "${business.name}" not found in page text`
        : "Business name is missing or still the placeholder",
      fixable: false,
      fix: "Update the gym content so the real business name appears in the visible page text.",
    });
  }

  // Require city and state abbreviation in rendered text. The full state name may
  // only appear in JSON-LD, so we do not require it here.
  const geoRequired = [business.geo.city, business.geo.stateAbbr].filter(Boolean);
  const geoMissing = geoRequired.filter((v) => !containsCaseInsensitive(text, v));
  if (geoMissing.length > 0) {
    failures.push({
      page: route,
      check: "geo-present",
      message: `City/state not found in page text: ${geoMissing.join(", ")}`,
      fixable: false,
      fix: "Add the gym's real city and state to the page copy so local SEO signals are present.",
    });
  }

  // Contact page should surface at least one direct contact method
  if (route === "/contact" || route.startsWith("/contact/")) {
    const hasPhone = business.phone && containsCaseInsensitive(text, business.phone);
    const hasEmail = business.email && containsCaseInsensitive(text, business.email);
    const hasStreet = business.address?.street && containsCaseInsensitive(text, business.address.street);
    if (!hasPhone && !hasEmail && !hasStreet) {
      failures.push({
        page: route,
        check: "contact-info-present",
        message: "Contact page is missing phone, email, and street address",
        fixable: false,
        fix: "Add the gym's phone, email, or street address to the contact page.",
      });
    }
  }

  return failures;
}

function checkNoPlaceholders(ctx: PageCheckContext): AuditFailure[] {
  const failures: AuditFailure[] = [];
  for (const placeholder of DEFAULT_PLACEHOLDER_STRINGS) {
    if (!placeholder || placeholder.length < 2) continue;
    if (containsPlaceholder(ctx.text, placeholder)) {
      failures.push({
        page: ctx.route,
        check: "placeholder-leak",
        message: `Placeholder text "${placeholder}" found in rendered content`,
        fixable: false,
        fix: "Replace the placeholder text with real gym-specific copy.",
      });
    }
  }
  return failures;
}

function checkJsonLdNap(ctx: PageCheckContext): AuditFailure[] {
  const failures: AuditFailure[] = [];
  const { route, jsonLd, business } = ctx;

  const objs = localBusinessObjects(jsonLd);
  if (objs.length === 0) {
    failures.push({
      page: route,
      check: "jsonld-localbusiness",
      message: "No LocalBusiness JSON-LD found on page",
      fixable: false,
      fix: "Add LocalBusiness JSON-LD with name, address, phone, and URL.",
    });
    return failures;
  }

  for (const obj of objs) {
    const o = obj as Record<string, unknown>;
    const name = valueString(o.name);
    const addressObj = o.address as Record<string, unknown> | undefined;
    const street = valueString(addressObj?.streetAddress);
    const city = valueString(addressObj?.addressLocality);
    const state = valueString(addressObj?.addressRegion);
    const telephone = valueString(o.telephone);
    const email = valueString(o.email);
    const url = valueString(o.url);

    if (name && !containsCaseInsensitive(name, business.name)) {
      failures.push({
        page: route,
        check: "jsonld-name",
        message: `JSON-LD name "${name}" does not match business name "${business.name}"`,
        fixable: false,
        fix: "Update the JSON-LD name to match the real gym name exactly.",
      });
    }
    if (street && business.address?.street && !containsCaseInsensitive(street, business.address.street)) {
      failures.push({
        page: route,
        check: "jsonld-street",
        message: `JSON-LD street mismatch: rendered "${street}" != business "${business.address.street}"`,
        fixable: false,
        fix: "Update the JSON-LD street address to match the gym's real address.",
      });
    }
    if (city && business.address?.city && !containsCaseInsensitive(city, business.address.city)) {
      failures.push({
        page: route,
        check: "jsonld-city",
        message: `JSON-LD city mismatch: rendered "${city}" != business "${business.address.city}"`,
        fixable: false,
        fix: "Update the JSON-LD city to match the gym's real city.",
      });
    }
    if (state && business.address?.state && !containsCaseInsensitive(state, business.address.state)) {
      failures.push({
        page: route,
        check: "jsonld-state",
        message: `JSON-LD state mismatch: rendered "${state}" != business "${business.address.state}"`,
        fixable: false,
        fix: "Update the JSON-LD state to match the gym's real state.",
      });
    }
    if (telephone && business.phone && telephone !== business.phone) {
      failures.push({
        page: route,
        check: "jsonld-phone",
        message: `JSON-LD phone mismatch: rendered "${telephone}" != business "${business.phone}"`,
        fixable: false,
        fix: "Update the JSON-LD telephone to match the gym's real phone number.",
      });
    }
    if (email && business.email && email !== business.email) {
      failures.push({
        page: route,
        check: "jsonld-email",
        message: `JSON-LD email mismatch: rendered "${email}" != business "${business.email}"`,
        fixable: false,
        fix: "Update the JSON-LD email to match the gym's real email address.",
      });
    }
    if (url && business.name && !containsCaseInsensitive(url, business.name)) {
      // The URL should be the site's origin. We only sanity-check it isn't a placeholder domain.
      if (url.includes("example.com") || url.includes("yourgym")) {
        failures.push({
          page: route,
          check: "jsonld-url",
          message: `JSON-LD URL looks like a placeholder: ${url}`,
          fixable: false,
          fix: "Replace the JSON-LD URL with the real gym website URL.",
        });
      }
    }
  }

  return failures;
}

function checkLinksInternal(ctx: PageCheckContext, links: string[]): AuditFailure[] {
  const failures: AuditFailure[] = [];
  for (const href of links) {
    if (!href || isExternalOrAnchor(href)) continue;
    const clean = normalizePath(firstSegment(href));
    if (!ctx.allowedPaths.has(clean)) {
      failures.push({
        page: ctx.route,
        check: "internal-link-valid",
        message: `Internal link "${href}" points to a route that will not be generated`,
        fixable: true,
        fix: "Point the link to an existing page route or remove it.",
      });
    }
  }
  return failures;
}

export function auditPage(
  route: string,
  html: string,
  business: BusinessInfo,
  allowedPaths: Set<string>,
  internalLinks?: string[],
): { failures: AuditFailure[]; warnings: string[] } {
  const { text, jsonLd } = extractTextAndJsonLd(html);
  const ctx: PageCheckContext = { route, text, jsonLd, business, allowedPaths };

  const failures = [
    ...checkBusinessInfoPresent(ctx),
    ...checkNoPlaceholders(ctx),
    ...checkJsonLdNap(ctx),
    ...(internalLinks ? checkLinksInternal(ctx, internalLinks) : []),
  ];

  const warnings: string[] = [];
  // Surface the raw JSON-LD parse error as a warning if it did not fail the NAP check
  for (const ld of jsonLd) {
    if ((ld as { __parseError?: boolean })?.__parseError) {
      warnings.push(`${route}: JSON-LD script could not be parsed (raw length ${String((ld as { raw?: string }).raw?.length ?? 0)})`);
    }
  }

  return { failures, warnings };
}

function cleanServiceArea(serviceArea: string[] | undefined): { cleaned: string[]; changed: boolean } {
  if (!serviceArea) return { cleaned: [], changed: false };
  const nearbyCityRe = /nearby\s*city/i;
  const cleaned = serviceArea.filter((c) => !nearbyCityRe.test(c));
  return { cleaned, changed: cleaned.length !== serviceArea.length };
}

export interface SelfHealResult {
  content: GymSiteContent;
  healed: boolean;
  heals: string[];
}

/**
 * Apply deterministic fixes to the generate artifact when the audit found
 * fixable failures. Returns the (possibly mutated) content and a list of heals.
 */
export function applySelfHeals(
  content: GymSiteContent,
  _failures: AuditFailure[],
): SelfHealResult {
  const allowedPaths = buildAllowedPaths(content);
  const heals: string[] = [];

  // 1. Nav/footer links
  const navWarnings: string[] = [];
  const sanitizedNav = sanitizeNavigationLinks(content.navigation, allowedPaths, navWarnings);
  if (
    JSON.stringify(sanitizedNav.header) !== JSON.stringify(content.navigation.header) ||
    JSON.stringify(sanitizedNav.footer) !== JSON.stringify(content.navigation.footer)
  ) {
    content.navigation = sanitizedNav;
    heals.push(...navWarnings);
  }

  // 2. Hero and business CTAs
  const ctaWarnings: string[] = [];
  sanitizeContentCtas(content.pages, content.business, ctaWarnings);
  if (ctaWarnings.length > 0) {
    heals.push(...ctaWarnings);
  }

  // 3. Service area placeholder removal
  const { cleaned, changed } = cleanServiceArea(content.business.serviceArea);
  if (changed) {
    content.business.serviceArea = cleaned;
    heals.push("Removed placeholder serviceArea entries");
  }

  // 4. Baseline social URLs that still contain the placeholder gym handle
  const social = content.business.social;
  if (social) {
    for (const [platform, url] of Object.entries(social)) {
      if (typeof url === "string" && /yourgym/i.test(url) && content.business.name !== DEFAULT_BUSINESS_NAME) {
        delete (social as Record<string, string | undefined>)[platform];
        heals.push(`Removed placeholder ${platform} URL (${url})`);
      }
    }
  }

  return { content, healed: heals.length > 0, heals };
}
