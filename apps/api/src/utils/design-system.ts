import type { SiteSection, ThemeTokens } from "@ploy-gyms/shared-types";

export interface DesignSystem {
  version: "1";
  siteMetadata: {
    framework: string;
    mode: string;
    targetUrl: string;
    businessName?: string;
    generatedAt: string;
  };
  global: {
    tokens: ThemeTokens;
    shell: {
      header?: SiteSection;
      footer?: SiteSection;
      navLinks: { label: string; href: string }[];
    };
  };
  business: {
    name?: string;
    tagline?: string;
  };
  reference: {
    screenshotUrl?: string | null;
  };
}

export interface BuildDesignSystemInput {
  blueprint: {
    site_metadata: {
      framework: string;
      mode: string;
      target_url: string;
      business_name?: string;
      generated_at: string;
    };
    design_tokens: ThemeTokens;
    global_shell: {
      header?: SiteSection;
      footer?: SiteSection;
      navLinks: { label: string; href: string }[];
    };
  };
  referenceScreenshotUrl?: string | null;
}

export function buildDesignSystem(input: BuildDesignSystemInput): DesignSystem {
  const { blueprint, referenceScreenshotUrl } = input;
  return {
    version: "1",
    siteMetadata: {
      framework: blueprint.site_metadata.framework,
      mode: blueprint.site_metadata.mode,
      targetUrl: blueprint.site_metadata.target_url,
      businessName: blueprint.site_metadata.business_name,
      generatedAt: blueprint.site_metadata.generated_at,
    },
    global: {
      tokens: blueprint.design_tokens,
      shell: {
        header: blueprint.global_shell.header,
        footer: blueprint.global_shell.footer,
        navLinks: blueprint.global_shell.navLinks,
      },
    },
    business: {
      name: blueprint.site_metadata.business_name,
    },
    reference: {
      screenshotUrl: referenceScreenshotUrl ?? null,
    },
  };
}
