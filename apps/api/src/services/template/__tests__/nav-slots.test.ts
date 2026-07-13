import { describe, test, expect } from "vitest";
import { buildNavigation, convertNavItems, mapToTemplateRoute, type CapturedNavItem } from "../nav-slots";

// ── mapToTemplateRoute ────────────────────────────────────────────────────────

describe("mapToTemplateRoute", () => {
  test("exact template routes pass through unchanged", () => {
    expect(mapToTemplateRoute("/about")).toBe("/about");
    expect(mapToTemplateRoute("/contact")).toBe("/contact");
    expect(mapToTemplateRoute("/pricing")).toBe("/pricing");
    expect(mapToTemplateRoute("/schedule")).toBe("/schedule");
    expect(mapToTemplateRoute("/blog")).toBe("/blog");
    expect(mapToTemplateRoute("/programs")).toBe("/programs");
    expect(mapToTemplateRoute("/local-guide")).toBe("/local-guide");
    expect(mapToTemplateRoute("/")).toBe("/");
  });

  test("membership variants map to /pricing", () => {
    expect(mapToTemplateRoute("/membership")).toBe("/pricing");
    expect(mapToTemplateRoute("/membership-pricing")).toBe("/pricing");
  });

  test("unknown slug-based paths keep original href", () => {
    // /rates has no pricing/membership keyword — keep original so template can redirect
    expect(mapToTemplateRoute("/rates")).toBe("/rates");
    expect(mapToTemplateRoute("/drop-in")).toBe("/drop-in");
    expect(mapToTemplateRoute("/nutrition")).toBe("/nutrition");
  });

  test("about variants map to /about", () => {
    expect(mapToTemplateRoute("/about-us")).toBe("/about");
    expect(mapToTemplateRoute("/our-story")).toBe("/our-story"); // not matched, keeps original
  });

  test("class/schedule variants map to /schedule", () => {
    expect(mapToTemplateRoute("/class-schedule")).toBe("/schedule");
    expect(mapToTemplateRoute("/classes")).toBe("/schedule");
  });

  test("blog/news variants map to /blog", () => {
    expect(mapToTemplateRoute("/blog")).toBe("/blog");
    expect(mapToTemplateRoute("/news")).toBe("/blog");
    expect(mapToTemplateRoute("/articles")).toBe("/blog");
  });

  test("/programs/* subpaths pass through for program detail pages", () => {
    expect(mapToTemplateRoute("/programs/crossfit")).toBe("/programs/crossfit");
    expect(mapToTemplateRoute("/programs/hyrox")).toBe("/programs/hyrox");
  });

  test("unknown paths keep original href", () => {
    expect(mapToTemplateRoute("/nutrition")).toBe("/nutrition");
    expect(mapToTemplateRoute("/hyrox-jump-start")).toBe("/hyrox-jump-start");
    expect(mapToTemplateRoute("/drop-in")).toBe("/drop-in");
  });

  test("empty or root returns /", () => {
    expect(mapToTemplateRoute("")).toBe("/");
    expect(mapToTemplateRoute("/")).toBe("/");
  });
});

// ── convertNavItems ───────────────────────────────────────────────────────────

describe("convertNavItems", () => {
  test("preserves label exactly as-is from original site", () => {
    const items: CapturedNavItem[] = [
      { label: "CrossTrain Classes", href: "/crosstrain" },
      { label: "Sweat Classes", href: "/sweat" },
      { label: "Rates", href: "/pricing" },
    ];
    const result = convertNavItems(items);
    expect(result[0].label).toBe("CrossTrain Classes");
    expect(result[1].label).toBe("Sweat Classes");
    expect(result[2].label).toBe("Rates"); // label kept even though href maps to /pricing
    expect(result[2].href).toBe("/pricing");
  });

  test("filters out login/account utility items", () => {
    const items: CapturedNavItem[] = [
      { label: "About Us", href: "/about" },
      { label: "Login", href: "/login" },
      { label: "My Account", href: "/account" },
      { label: "Sign Up", href: "/signup" },
      { label: "Contact", href: "/contact" },
    ];
    const result = convertNavItems(items);
    const labels = result.map((i) => i.label);
    expect(labels).not.toContain("Login");
    expect(labels).not.toContain("My Account");
    expect(labels).not.toContain("Sign Up");
    expect(labels).toContain("About Us");
    expect(labels).toContain("Contact");
  });

  test("preserves nested children (dropdown/submenu) structure", () => {
    const items: CapturedNavItem[] = [
      {
        label: "Programs",
        href: "/programs",
        children: [
          { label: "CrossFit", href: "/crossfit" },
          { label: "Hyrox", href: "/hyrox", children: [
            { label: "Hyrox Jump Start", href: "/hyrox/jump-start" },
            { label: "Hyrox Prep", href: "/hyrox/prep" },
          ]},
        ],
      },
    ];
    const result = convertNavItems(items);
    expect(result[0].label).toBe("Programs");
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children![0].label).toBe("CrossFit");
    expect(result[0].children![1].label).toBe("Hyrox");
    expect(result[0].children![1].children).toHaveLength(2);
    expect(result[0].children![1].children![0].label).toBe("Hyrox Jump Start");
    expect(result[0].children![1].children![0].href).toBe("/hyrox/jump-start");
  });

  test("items with no children have no children property", () => {
    const items: CapturedNavItem[] = [{ label: "About", href: "/about" }];
    const result = convertNavItems(items);
    expect(result[0].children).toBeUndefined();
  });
});

// ── buildNavigation ───────────────────────────────────────────────────────────

describe("buildNavigation", () => {
  const programs = [
    { slug: "group-strength", name: "Group Strength" },
    { slug: "cardio-bootcamp", name: "Cardio Bootcamp" },
    { slug: "personal-training", name: "Personal Training" },
  ];

  test("uses capturedNav labels and structure when provided", () => {
    const capturedNav: CapturedNavItem[] = [
      { label: "Get Started", href: "/contact" },
      { label: "CrossTrain Classes", href: "/crosstrain-classes" },
      { label: "Rates", href: "/pricing" },
      { label: "About Us", href: "/about" },
      { label: "Blogs", href: "/blog" },
    ];
    const nav = buildNavigation(capturedNav, programs);
    const labels = nav.header.map((i) => i.label);
    expect(labels).toContain("Get Started");
    expect(labels).toContain("CrossTrain Classes"); // original label preserved, not "Classes"
    expect(labels).toContain("Rates");              // original label preserved, not "Pricing"
    expect(labels).toContain("About Us");           // original label, not "About"
    expect(labels).toContain("Blogs");              // original label, not "Blog"
  });

  test("header never contains Login/Account utility items", () => {
    const capturedNav: CapturedNavItem[] = [
      { label: "About", href: "/about" },
      { label: "Login", href: "/login" },
      { label: "Search", href: "/search" },
      { label: "Contact", href: "/contact" },
    ];
    const nav = buildNavigation(capturedNav, programs);
    const labels = nav.header.map((i) => i.label);
    expect(labels).not.toContain("Login");
    expect(labels).not.toContain("Search");
  });

  test("footer Company links mirror header items (labels + hrefs match)", () => {
    const capturedNav: CapturedNavItem[] = [
      { label: "Rates", href: "/pricing" },
      { label: "About Us", href: "/about" },
      { label: "Contact", href: "/contact" },
    ];
    const nav = buildNavigation(capturedNav, programs);
    const companyGroup = nav.footer.find((g) => g.label === "Company");
    expect(companyGroup).toBeDefined();
    const footerLabels = companyGroup!.links.map((l) => l.label);
    // Footer matches header labels — "Rates" not "Pricing", "About Us" not "About"
    expect(footerLabels).toContain("Rates");
    expect(footerLabels).toContain("About Us");
    expect(footerLabels).toContain("Contact");
  });

  test("footer includes Privacy Policy when a legal page exists", () => {
    const briefs = [{ path: "/privacy-policy", pageType: "legal" as const }];
    const nav = buildNavigation([], programs, briefs);
    const companyGroup = nav.footer.find((g) => g.label === "Company");
    const privacyLink = companyGroup?.links.find((l) => l.label === "Privacy Policy");
    expect(privacyLink).toBeDefined();
    expect(privacyLink?.href).toBe("/legal/privacy-policy");
  });

  test("footer omits Privacy Policy when no legal page exists", () => {
    const nav = buildNavigation([], programs);
    const companyGroup = nav.footer.find((g) => g.label === "Company");
    const privacyLink = companyGroup?.links.find((l) => l.label === "Privacy Policy");
    expect(privacyLink).toBeUndefined();
  });

  test("footer Programs group lists all program pages", () => {
    const nav = buildNavigation([], programs);
    const programsGroup = nav.footer.find((g) => g.label === "Programs");
    expect(programsGroup).toBeDefined();
    expect(programsGroup!.links).toHaveLength(3);
    expect(programsGroup!.links[0]).toEqual({ label: "Group Strength", href: "/programs/group-strength" });
    expect(programsGroup!.links[1]).toEqual({ label: "Cardio Bootcamp", href: "/programs/cardio-bootcamp" });
  });

  test("fallback header includes Home + programs + inferred pages from content briefs", () => {
    const briefs = [
      { path: "/about-us", pageType: "about" },
      { path: "/membership-pricing", pageType: "pricing" },
      { path: "/contact", pageType: "contact" },
    ];
    const nav = buildNavigation([], programs, briefs);
    const hrefs = nav.header.map((i) => i.href);
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/programs");
    expect(hrefs).toContain("/about");
    expect(hrefs).toContain("/pricing");
    expect(hrefs).toContain("/contact");
    // Labels derived from original slug, not type
    const pricingItem = nav.header.find((i) => i.href === "/pricing");
    expect(pricingItem?.label).toBe("Membership Pricing"); // /membership-pricing → full slug, title-cased
    const aboutItem = nav.header.find((i) => i.href === "/about");
    expect(aboutItem?.label).toBe("About Us"); // /about-us → "About Us"
  });

  test("fallback programs dropdown uses real program names and slugs", () => {
    const nav = buildNavigation([], programs);
    const programsItem = nav.header.find((i) => i.href === "/programs");
    expect(programsItem).toBeDefined();
    expect(programsItem!.children).toHaveLength(3);
    expect(programsItem!.children![0]).toEqual({ label: "Group Strength", href: "/programs/group-strength" });
  });

  test("nav update — owner adds new item by editing capturedNav", () => {
    // Simulate: owner adds "Nutrition" to nav after launch
    const originalNav: CapturedNavItem[] = [
      { label: "Programs", href: "/programs" },
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ];
    const updatedNav: CapturedNavItem[] = [
      ...originalNav,
      { label: "Nutrition", href: "/nutrition" }, // new item added
    ];
    const navAfter = buildNavigation(updatedNav, programs);
    const labels = navAfter.header.map((i) => i.label);
    expect(labels).toContain("Nutrition");
    expect(labels).toContain("Programs");
    // Footer also picks up the new item
    const companyGroup = navAfter.footer.find((g) => g.label === "Company");
    const footerLabels = companyGroup!.links.map((l) => l.label);
    expect(footerLabels).toContain("Nutrition");
  });

  test("nav update — owner removes an item", () => {
    const originalNav: CapturedNavItem[] = [
      { label: "Drop-In", href: "/drop-in" },
      { label: "Programs", href: "/programs" },
      { label: "Contact", href: "/contact" },
    ];
    const updatedNav = originalNav.filter((i) => i.label !== "Drop-In");
    const navAfter = buildNavigation(updatedNav, programs);
    const labels = navAfter.header.map((i) => i.label);
    expect(labels).not.toContain("Drop-In");
    expect(labels).toContain("Programs");
  });

  test("nav update — owner renames an item", () => {
    const updatedNav: CapturedNavItem[] = [
      { label: "Membership Options", href: "/pricing" }, // was "Rates"
      { label: "Our Story", href: "/about" },            // was "About Us"
    ];
    const nav = buildNavigation(updatedNav, programs);
    const labels = nav.header.map((i) => i.label);
    expect(labels).toContain("Membership Options"); // new name preserved
    expect(labels).toContain("Our Story");
    expect(labels).not.toContain("Rates");
    expect(labels).not.toContain("About Us");
  });

  test("deeply nested programs submenu preserved after owner edit", () => {
    const updatedNav: CapturedNavItem[] = [
      {
        label: "Programs",
        href: "/programs",
        children: [
          { label: "CrossTrain", href: "/crosstrain" },
          {
            label: "Hyrox",
            href: "/hyrox",
            children: [
              { label: "Hyrox Jump Start", href: "/hyrox/jump-start" },
              { label: "Hyrox Prep", href: "/hyrox/prep" },
            ],
          },
        ],
      },
      { label: "Contact", href: "/contact" },
    ];
    const nav = buildNavigation(updatedNav, programs);
    const programsItem = nav.header.find((i) => i.label === "Programs");
    expect(programsItem?.children).toHaveLength(2);
    const hyrox = programsItem?.children?.find((c) => c.label === "Hyrox");
    expect(hyrox?.children).toHaveLength(2);
    expect(hyrox?.children?.[0].label).toBe("Hyrox Jump Start");
    expect(hyrox?.children?.[1].label).toBe("Hyrox Prep");
  });

  test("deduplicates captured nav items with equivalent hrefs", () => {
    const capturedNav: CapturedNavItem[] = [
      { label: "Drop-In", href: "/drop-in" },
      { label: "Drop In", href: "/drop-in" },
      { label: "About Us", href: "/about" },
      { label: "About", href: "/about/" },
      { label: "Contact", href: "/contact" },
    ];
    const nav = buildNavigation(capturedNav, programs);
    const labels = nav.header.map((i) => i.label);
    expect(labels).toEqual(["Drop-In", "About Us", "Contact"]);
  });

  test("groups flat program pages under a single Programs dropdown", () => {
    const capturedNav: CapturedNavItem[] = [
      { label: "Group Strength", href: "/programs/group-strength" },
      { label: "Cardio Bootcamp", href: "/programs/cardio-bootcamp" },
      { label: "Personal Training", href: "/programs/personal-training" },
      { label: "Schedule", href: "/schedule" },
      { label: "Rates", href: "/pricing" },
      { label: "About Us", href: "/about" },
    ];
    const nav = buildNavigation(capturedNav, programs);
    const topLabels = nav.header.map((i) => i.label);
    expect(topLabels).toEqual(["Programs", "Schedule", "Rates", "About Us"]);

    const programsItem = nav.header.find((i) => i.label === "Programs");
    expect(programsItem?.children).toHaveLength(3);
    const childLabels = programsItem?.children?.map((c) => c.label);
    expect(childLabels).toEqual([
      "Group Strength",
      "Cardio Bootcamp",
      "Personal Training",
    ]);
  });

  test("drops captured program links that have no generated program page", () => {
    const capturedNav: CapturedNavItem[] = [
      { label: "Get Started", href: "/programs/get-started" },
      { label: "Drop-In", href: "/programs/drop-in" },
      { label: "CrossTrain Classes", href: "/programs/crosstrain-classes" },
      { label: "Schedule", href: "/schedule" },
      { label: "Rates", href: "/pricing" },
    ];
    const nav = buildNavigation(capturedNav, programs);
    const topLabels = nav.header.map((i) => i.label);
    expect(topLabels).toEqual(["Programs", "Schedule", "Rates"]);

    const programsItem = nav.header.find((i) => i.label === "Programs");
    expect(programsItem?.children).toHaveLength(3);
    expect(programsItem?.children?.map((c) => c.href)).toEqual([
      "/programs/group-strength",
      "/programs/cardio-bootcamp",
      "/programs/personal-training",
    ]);
  });

  test("does not regroup program pages when owner already created a Programs parent", () => {
    const capturedNav: CapturedNavItem[] = [
      {
        label: "Programs",
        href: "/programs",
        children: [
          { label: "Group Strength", href: "/programs/group-strength" },
          { label: "Cardio Bootcamp", href: "/programs/cardio-bootcamp" },
        ],
      },
      { label: "Schedule", href: "/schedule" },
      { label: "Rates", href: "/pricing" },
    ];
    const nav = buildNavigation(capturedNav, programs);
    const topLabels = nav.header.map((i) => i.label);
    expect(topLabels).toEqual(["Programs", "Schedule", "Rates"]);
    expect(nav.header[0].children).toHaveLength(2);
  });
});
