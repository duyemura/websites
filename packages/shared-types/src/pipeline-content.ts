/**
 * Content-stage pipeline artifact types.
 *
 * The content stage produces per-page briefs that map what was found on the
 * original site to the sections a template page needs. These types are shared
 * between the stage runner (apps/api/scripts/stages/content.ts) and the
 * generate stage (apps/api/src/services/template/generate-content.ts) so both
 * sides agree on the contract without cross-rootDir imports.
 */

export type PageBriefVisitorRole =
  | "awareness"
  | "consideration"
  | "conversion"
  | "retention"
  | "utility";

export interface PageBrief {
  path: string;
  pageType: string;
  purpose: string;
  visitorRole: PageBriefVisitorRole;
  sectionsNeeded: string[];
  contentFound: {
    hero: { headline: string | null; subheading: string | null; ctaLabel: string | null };
    body: string;
    cta: string | null;
    valueProps: Array<{ headline: string; body: string }>;
    testimonials: Array<{ quote: string; name: string; program: string | null }>;
    faq: Array<{ question: string; answer: string }>;
    communityHeadline: string | null;
    trustHeadline: string | null;
    shortDescription: string | null;
    whoIsItFor: string[];
    whatMakesUsDifferent: string[];
    gymStory: string | null;
    team: Array<{ name: string; title: string; bio: string | null; photoUrl?: string }>;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    hours: string | null;
    plans: Array<{
      name: string;
      price: string;
      period: string | null;
      description: string | null;
      features: string[];
    }>;
  };
  contentMissing: string[];
  generationHint: string;
}

export interface ContentArtifact {
  siteUuid: string;
  createdAt: string;
  pages: PageBrief[];
}
