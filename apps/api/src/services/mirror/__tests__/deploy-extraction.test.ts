import { describe, test, expect } from "vitest";
import { extractNavStructure, extractContentOutline, extractHeroImageUrl } from "../deploy";

// ── extractNavStructure ───────────────────────────────────────────────────────

describe("extractNavStructure", () => {
  const origin = "https://example-gym.com";

  test("extracts flat nav items from a simple <ul> nav", () => {
    const html = `<html><body>
      <nav>
        <ul>
          <li><a href="/about">About Us</a></li>
          <li><a href="/pricing">Membership</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
    </body></html>`;
    const items = extractNavStructure(html, origin);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ label: "About Us", href: "/about" });
    expect(items[1]).toEqual({ label: "Membership", href: "/pricing" });
    expect(items[2]).toEqual({ label: "Contact", href: "/contact" });
  });

  test("preserves nested dropdown children", () => {
    const html = `<html><body>
      <nav>
        <ul>
          <li>
            <a href="/programs">Programs</a>
            <ul>
              <li><a href="/programs/crossfit">CrossFit</a></li>
              <li><a href="/programs/hyrox">Hyrox</a></li>
            </ul>
          </li>
          <li><a href="/about">About</a></li>
        </ul>
      </nav>
    </body></html>`;
    const items = extractNavStructure(html, origin);
    const programs = items.find((i) => i.label === "Programs");
    expect(programs).toBeDefined();
    expect(programs?.children).toHaveLength(2);
    expect(programs?.children?.[0]).toEqual({ label: "CrossFit", href: "/programs/crossfit" });
    expect(programs?.children?.[1]).toEqual({ label: "Hyrox", href: "/programs/hyrox" });
  });

  test("filters out login/account utility items", () => {
    const html = `<html><body>
      <nav>
        <ul>
          <li><a href="/about">About</a></li>
          <li><a href="/login">Login</a></li>
          <li><a href="/account">Account</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
    </body></html>`;
    const items = extractNavStructure(html, origin);
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("Login");
    expect(labels).not.toContain("Account");
    expect(labels).toContain("About");
    expect(labels).toContain("Contact");
  });

  test("strips cross-origin hrefs", () => {
    const html = `<html><body>
      <nav>
        <ul>
          <li><a href="/about">About</a></li>
          <li><a href="https://other-site.com/signup">Signup</a></li>
        </ul>
      </nav>
    </body></html>`;
    const items = extractNavStructure(html, origin);
    const externalItem = items.find((i) => i.label === "Signup");
    // Should be filtered (empty href = cross-origin stripped)
    expect(externalItem).toBeUndefined();
  });

  test("returns empty array when no nav element found", () => {
    const html = `<html><body><div>No nav here</div></body></html>`;
    const items = extractNavStructure(html, origin);
    expect(items).toHaveLength(0);
  });

  test("handles Webflow w-nav structure", () => {
    const html = `<html><body>
      <div class="navbar w-nav">
        <nav class="nav-menu w-nav-menu">
          <a href="/classes" class="nav-link w-nav-link">Classes</a>
          <a href="/pricing" class="nav-link w-nav-link">Pricing</a>
          <a href="/contact" class="nav-link w-nav-link">Contact</a>
        </nav>
      </div>
    </body></html>`;
    const items = extractNavStructure(html, origin);
    // Webflow uses flat links not <ul><li>, falls back to flat link extraction
    expect(items.length).toBeGreaterThan(0);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Classes");
    expect(labels).toContain("Pricing");
  });

  test("deduplicates repeated nav items", () => {
    const html = `<html><body>
      <nav>
        <ul>
          <li><a href="/about">About</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
    </body></html>`;
    const items = extractNavStructure(html, origin);
    const aboutItems = items.filter((i) => i.label === "About");
    expect(aboutItems).toHaveLength(1);
  });
});

// ── extractContentOutline ─────────────────────────────────────────────────────

describe("extractContentOutline", () => {
  test("extracts hero section headings and paragraphs", () => {
    const html = `<html><body>
      <section class="hero-section">
        <h1>Find Your Fitness Goals</h1>
        <h2 class="subheading">Best Gym in Torrance</h2>
        <p>Join our community of 400+ members.</p>
      </section>
    </body></html>`;
    const outline = extractContentOutline(html);
    expect(outline).toContain("hero");
    expect(outline).toContain("Find Your Fitness Goals");
    expect(outline).toContain("Best Gym in Torrance");
    expect(outline).toContain("Join our community");
  });

  test("strips scripts, styles, and iframes", () => {
    const html = `<html><body>
      <section class="hero">
        <script>alert('xss')</script>
        <style>.foo { color: red }</style>
        <iframe src="https://evil.com"></iframe>
        <h1>Real Content</h1>
      </section>
    </body></html>`;
    const outline = extractContentOutline(html);
    expect(outline).not.toContain("alert");
    expect(outline).not.toContain("color: red");
    expect(outline).not.toContain("evil.com");
    expect(outline).toContain("Real Content");
  });

  test("falls back to body-level extraction when no sections match", () => {
    // No section/article/[class*=section] — uses body fallback
    const html = `<html><body>
      <div class="container">
        <h1>Membership Cancellation Request</h1>
        <p>Please fill out the form below.</p>
      </div>
    </body></html>`;
    const outline = extractContentOutline(html);
    expect(outline).toContain("Membership Cancellation Request");
    expect(outline).toContain("page");
  });

  test("skips body > header and body > footer (top-level only)", () => {
    const html = `<html><body>
      <header><nav><a href="/">Home</a></nav></header>
      <section class="hero-section">
        <h1>Hero Content</h1>
      </section>
      <footer><p>Copyright 2024</p></footer>
    </body></html>`;
    const outline = extractContentOutline(html);
    expect(outline).not.toContain("Home");
    expect(outline).not.toContain("Copyright");
    expect(outline).toContain("Hero Content");
  });

  test("body-level <header> is stripped (use <section class=hero> for hero content)", () => {
    // body > header is removed before section detection — this is intentional so the
    // site-wide header chrome (nav links, logo) doesn't pollute the content outline.
    // Webflow hero content should live in <section class="hero-section">, not <header>.
    const html = `<html><body>
      <header class="hero-section">
        <h1>Achieve Your Goals</h1>
        <p>Premium gym in Torrance.</p>
      </header>
    </body></html>`;
    const outline = extractContentOutline(html);
    // body > header stripped → fallback finds nothing → empty outline is correct behavior
    expect(outline).toBe("");
  });
});

// ── extractHeroImageUrl ───────────────────────────────────────────────────────

describe("extractHeroImageUrl", () => {
  test("returns og:image when it starts with /_assets/", () => {
    const html = `<html><head>
      <meta property="og:image" content="/_assets/abc123def456.jpg" />
    </head><body></body></html>`;
    expect(extractHeroImageUrl(html)).toBe("/_assets/abc123def456.jpg");
  });

  test("ignores og:image with external URLs", () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.webflow.com/hero.jpg" />
    </head><body>
      <section class="hero"><img src="/_assets/local-hero.webp" /></section>
    </body></html>`;
    // External og:image ignored; falls through to hero img
    expect(extractHeroImageUrl(html)).toBe("/_assets/local-hero.webp");
  });

  test("finds first img in hero section", () => {
    const html = `<html><body>
      <section class="hero-section">
        <img src="/_assets/hero-photo.webp" alt="Gym floor" />
        <h1>Welcome</h1>
      </section>
      <section class="other">
        <img src="/_assets/other.jpg" alt="Other" />
      </section>
    </body></html>`;
    expect(extractHeroImageUrl(html)).toBe("/_assets/hero-photo.webp");
  });

  test("falls back to first body img when no hero section", () => {
    const html = `<html><body>
      <div class="wrapper">
        <img src="/_assets/fallback.jpg" alt="Fallback" />
      </div>
    </body></html>`;
    expect(extractHeroImageUrl(html)).toBe("/_assets/fallback.jpg");
  });

  test("returns undefined when no /_assets/ images found", () => {
    const html = `<html><body>
      <img src="https://cdn.webflow.com/image.jpg" alt="External" />
    </body></html>`;
    expect(extractHeroImageUrl(html)).toBeUndefined();
  });

  test("returns undefined for empty HTML", () => {
    expect(extractHeroImageUrl("")).toBeUndefined();
    expect(extractHeroImageUrl("<html><body></body></html>")).toBeUndefined();
  });
});
