import { describe, test, expect, vi } from "vitest";
import { build, authHeaders } from "../helper";
import { db } from "../../src/database";
import { saveSiteHierarchyDoc } from "../../src/utils/site-hierarchy-io";
import { saveDesignSystemDoc, loadDesignSystemDoc } from "../../src/utils/design-system-io";
import { saveSectionVisualEvidenceDoc } from "../../src/utils/section-visual-evidence-io";
import type { SiteHierarchy } from "../../src/types/site-hierarchy";
import type { DesignSystemV2 } from "../../src/types/design-system-v2";
import type { SectionVisualEvidence } from "../../src/types/section-visual-evidence";

function makeDesignSystem(primary: string): DesignSystemV2 {
  return {
    version: "2",
    siteMetadata: {
      framework: "astro",
      mode: "replication",
      targetUrl: "https://example.com",
      generatedAt: new Date().toISOString(),
    },
    global: {
      tokens: {
        colors: {
          primary,
          primaryForeground: "#ffffff",
          background: "#ffffff",
          foreground: "#171717",
          muted: "#f5f5f5",
          mutedForeground: "#737373",
          border: "#e5e5e5",
        },
        fonts: {
          heading: "Sans-serif",
          body: "Sans-serif",
        },
        radius: "0.5rem",
      },
      shell: { navLinks: [] },
      rules: {},
    },
    business: { name: "Reskin Gym" },
    brand: {
      logo: { type: "text", value: "Reskin Gym" },
      headingStyle: { uppercase: false, bold: true },
    },
    reference: { screenshotUrl: null },
  };
}

describe("POST /sites/:uuid/re-skin", () => {
  test("applies a new design system and enqueues built pages for rebuild", async () => {
    const app = await build();

    const workspace = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: authHeaders(),
      payload: { name: "Reskin Gym", slug: "reskin-gym" },
    });
    const workspaceUuid = workspace.json().uuid;

    const site = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { ...authHeaders(), "x-workspace-slug": "reskin-gym" },
      payload: { name: "Reskin Site", slug: "home" },
    });
    const siteUuid = site.json().uuid;

    const hierarchy: SiteHierarchy = {
      version: "1",
      siteMetadata: {
        framework: "astro",
        mode: "replication",
        targetUrl: "https://example.com",
        generatedAt: new Date().toISOString(),
      },
      pages: [
        {
          slug: "index",
          isHomePage: true,
          title: "Home",
          sections: [
            {
              id: "hero-1",
              tag: "hero",
              intent: "Introduce the gym and drive the primary CTA.",
              content: {
                heading: "Train with us",
                cta: { label: "Join", href: "#cta" },
              },
              evidenceId: "ev-1",
            },
          ],
        },
      ],
      buildPlan: {
        nextPage: "about",
        pageStatus: { index: "built", about: "planned" },
        buildOrder: ["index", "about"],
      },
    };
    await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, hierarchy);

    const evidence: SectionVisualEvidence = { version: "1", rows: [] };
    await saveSectionVisualEvidenceDoc(db, workspaceUuid, siteUuid, evidence);

    const originalDesignSystem = makeDesignSystem("#ff0000");
    await saveDesignSystemDoc(db, workspaceUuid, siteUuid, originalDesignSystem);

    const addSpy = vi
      .spyOn(app.queues.generatePage.queue, "add")
      .mockResolvedValue({ id: "queued", name: "generate_page" } as never);

    const newDesignSystem = makeDesignSystem("#0000ff");
    const response = await app.inject({
      method: "POST",
      url: `/api/sites/${siteUuid}/re-skin`,
      headers: { ...authHeaders(), "x-workspace-slug": "reskin-gym" },
      payload: { designSystem: newDesignSystem },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.enqueued).toEqual(["index"]);

    const saved = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
    expect(saved).not.toBeNull();
    expect((saved as DesignSystemV2).global.tokens.colors.primary).toBe("#0000ff");

    expect(addSpy).toHaveBeenCalledTimes(1);
    const queuedSlug = (addSpy.mock.calls[0]?.[1] as { pageSlug: string } | undefined)?.pageSlug;
    expect(queuedSlug).toBe("index");

    addSpy.mockRestore();
    await app.close();
  });
});
