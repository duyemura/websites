import type { SiteSection } from "@ploy-gyms/shared-types";

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function renderSectionComponent(section: SiteSection): string {
  switch (section.type) {
    case "Hero":
      return renderHero(section.props);
    case "Text":
      return renderText(section.props);
    case "SiteCardGroup":
      return renderCardGroup(section.props);
    case "SiteReviews":
      return renderReviews(section.props);
    case "SiteLocation":
      return renderLocation(section.props);
    case "SiteHeader":
      return renderHeader(section.props);
    case "SiteFooter":
      return renderFooter(section.props);
    default:
      return renderFallback(section);
  }
}

function renderHero(props: Record<string, unknown>): string {
  const title = str(props.title);
  const subtitle = str(props.subtitle);
  const cta = props.cta as { label?: string; href?: string } | null | undefined;
  const backgroundImage = props.backgroundImage as string | null | undefined;

  const ctaBlock =
    cta?.label && cta?.href
      ? `<a
  href=${json(cta.href)}
  class="mt-8 inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary-foreground)] px-6 py-3 text-sm font-semibold text-[var(--color-primary)] hover:opacity-90"
>
  {cta.label}
</a>`
      : "";

  const bgStyle = backgroundImage
    ? `style="background-image: url(${backgroundImage}); background-size: cover; background-position: center;"`
    : "";

  return `---
const title = ${json(title)};
const subtitle = ${json(subtitle)};
const cta = ${json(cta)};
const backgroundImage = ${json(backgroundImage)};
---

<section class="relative bg-[var(--color-primary)] py-24 px-6 text-center text-[var(--color-primary-foreground)] overflow-hidden" ${bgStyle}>
  <div class="relative z-10 mx-auto max-w-3xl">
    <h1 class="text-4xl font-extrabold tracking-tight sm:text-6xl font-[family-name:var(--font-heading)]">{title}</h1>
    {subtitle && <p class="mt-6 text-lg opacity-90 font-[family-name:var(--font-body)]">{subtitle}</p>}
    {cta && ${ctaBlock}}
  </div>
</section>`;
}

function renderText(props: Record<string, unknown>): string {
  const title = str(props.title);
  const body = str(props.body);
  const align = str(props.align) || "center";
  const alignClass = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center";

  return `---
const title = ${json(title)};
const body = ${json(body)};
---

<section class="py-16 px-6 max-w-4xl mx-auto ${alignClass} text-[var(--color-foreground)]">
  {title && <h2 class="text-3xl font-bold font-[family-name:var(--font-heading)]">{title}</h2>}
  {body && <p class="mt-6 text-lg whitespace-pre-line font-[family-name:var(--font-body)]">{body}</p>}
</section>`;
}

function renderCardGroup(props: Record<string, unknown>): string {
  const title = str(props.title);
  const layout = str(props.layout) || "grid";
  const cards = array<{ title?: string; description?: string }>(props.cards);
  const gridClass =
    layout === "row"
      ? "grid gap-6 sm:grid-cols-2"
      : cards.length >= 3
        ? "grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        : "grid gap-6 sm:grid-cols-2";

  return `---
const title = ${json(title)};
const cards = ${json(cards)};
---

<section class="py-16 px-6 bg-[var(--color-background)] text-[var(--color-foreground)]">
  <div class="max-w-6xl mx-auto">
    {title && <h2 class="text-3xl font-bold text-center mb-10 font-[family-name:var(--font-heading)]">{title}</h2>}
    <div class="${gridClass}">
      {cards.map((card) => (
        <div class="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] p-6">
          {card.title && <h3 class="text-xl font-semibold font-[family-name:var(--font-heading)]">{card.title}</h3>}
          {card.description && <p class="mt-2 text-[var(--color-muted-foreground)] font-[family-name:var(--font-body)]">{card.description}</p>}
        </div>
      ))}
    </div>
  </div>
</section>`;
}

function renderReviews(props: Record<string, unknown>): string {
  const title = str(props.title);
  const reviews = array<{ quote?: string; author?: string }>(props.reviews);

  return `---
const title = ${json(title)};
const reviews = ${json(reviews)};
---

<section class="py-16 px-6 bg-[var(--color-muted)] text-[var(--color-foreground)]">
  <div class="max-w-5xl mx-auto">
    {title && <h2 class="text-3xl font-bold text-center mb-10 font-[family-name:var(--font-heading)]">{title}</h2>}
    <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {reviews.map((review) => (
        <blockquote class="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-background)] p-6">
          {review.quote && <p class="text-lg italic font-[family-name:var(--font-body)]">&ldquo;{review.quote}&rdquo;</p>}
          {review.author && <footer class="mt-4 text-sm font-semibold text-[var(--color-muted-foreground)]">&mdash; {review.author}</footer>}
        </blockquote>
      ))}
    </div>
  </div>
</section>`;
}

function renderLocation(props: Record<string, unknown>): string {
  const title = str(props.title);
  const address = str(props.address);
  const hours = str(props.hours);
  const phone = str(props.phone);
  const mapLink = str(props.mapLink);

  return `---
const title = ${json(title)};
const address = ${json(address)};
const hours = ${json(hours)};
const phone = ${json(phone)};
const mapLink = ${json(mapLink)};
---

<section class="py-16 px-6 bg-[var(--color-background)] text-[var(--color-foreground)]">
  <div class="max-w-4xl mx-auto text-center">
    {title && <h2 class="text-3xl font-bold mb-6 font-[family-name:var(--font-heading)]">{title}</h2>}
    {address && <p class="text-lg whitespace-pre-line font-[family-name:var(--font-body)]">{address}</p>}
    {hours && <p class="mt-4 text-[var(--color-muted-foreground)] font-[family-name:var(--font-body)]">{hours}</p>}
    {phone && <p class="mt-2 font-[family-name:var(--font-body)]">{phone}</p>}
    {mapLink && (
      <a
        href={mapLink}
        class="mt-6 inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary)] px-6 py-3 text-sm font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        Get directions
      </a>
    )}
  </div>
</section>`;
}

function renderHeader(props: Record<string, unknown>): string {
  const logo = props.logo as { type?: string; value?: string } | null | undefined;
  const navLinks = array<{ label?: string; href?: string }>(props.navLinks);
  const ctaLabel = str(props.ctaLabel);
  const ctaHref = str(props.ctaHref);

  return `---
const logo = ${json(logo)};
const navLinks = ${json(navLinks)};
const ctaLabel = ${json(ctaLabel)};
const ctaHref = ${json(ctaHref)};
---

<header class="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)]">
  <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
    <a href="/" class="text-xl font-bold font-[family-name:var(--font-heading)]">
      {logo?.value ?? ""}
    </a>
    <nav class="hidden items-center gap-6 md:flex">
      {navLinks.map((link) => (
        <a href={link.href} class="text-sm font-medium hover:text-[var(--color-primary)]">
          {link.label}
        </a>
      ))}
    </nav>
    {ctaHref && ctaLabel && (
      <a
        href={ctaHref}
        class="rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        {ctaLabel}
      </a>
    )}
  </div>
</header>`;
}

function renderFooter(props: Record<string, unknown>): string {
  const businessName = str(props.businessName);
  const navLinks = array<{ label?: string; href?: string }>(props.navLinks);
  const socialLinks = array<{ platform?: string; url?: string } | { label?: string; href?: string }>(props.socialLinks);
  const copyright = str(props.copyright);

  return `---
const businessName = ${json(businessName)};
const navLinks = ${json(navLinks)};
const socialLinks = ${json(socialLinks)};
const copyright = ${json(copyright)};
---

<footer class="border-t border-[var(--color-border)] bg-[var(--color-muted)] py-12 px-6 text-[var(--color-foreground)]">
  <div class="max-w-6xl mx-auto flex flex-col items-center justify-between gap-6 md:flex-row">
    <div class="text-center md:text-left">
      {businessName && <p class="font-semibold font-[family-name:var(--font-heading)]">{businessName}</p>}
      {copyright && <p class="mt-1 text-sm text-[var(--color-muted-foreground)]">{copyright}</p>}
    </div>
    <nav class="flex flex-wrap justify-center gap-4">
      {navLinks.map((link) => (
        <a href={link.href} class="text-sm hover:text-[var(--color-primary)]">
          {link.label}
        </a>
      ))}
    </nav>
    <div class="flex gap-4">
      {socialLinks.map((social) => {
        const url = "url" in social ? social.url : social.href;
        const label = "platform" in social ? social.platform : social.label;
        return url ? (
          <a href={url} class="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]">
            {label}
          </a>
        ) : null;
      })}
    </div>
  </div>
</footer>`;
}

function renderFallback(section: SiteSection): string {
  const title = str(section.props.title) || section.type;
  const body = str(section.props.body);

  return `---
const title = ${json(title)};
const body = ${json(body)};
---

<section class="py-12 px-6 bg-[var(--color-background)] text-[var(--color-foreground)]">
  <div class="max-w-4xl mx-auto">
    <h2 class="text-2xl font-bold font-[family-name:var(--font-heading)]">{title}</h2>
    {body && <p class="mt-4 whitespace-pre-line font-[family-name:var(--font-body)]">{body}</p>}
  </div>
</section>`;
}
