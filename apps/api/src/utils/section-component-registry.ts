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

function isSvgUrl(url: string): boolean {
  return url.startsWith("data:image/svg") || /\.svg([?#]|$)/i.test(url);
}

export function renderSectionComponent(section: SiteSection): string {
  switch (section.type) {
    case "Hero":
      return renderHero(section.props);
    case "Text":
      return renderText(section.props);
    case "SiteCardGroup":
      return renderCardGroup(section.props);
    case "SiteSteps":
      return renderSteps(section.props);
    case "SiteReviews":
      return renderReviews(section.props);
    case "SiteLocation":
      return renderLocation(section.props);
    case "SiteHeader":
      return renderHeader(section.props);
    case "SiteFooter":
      return renderFooter(section.props);
    case "SiteCTA":
      return renderCTA(section.props);
    case "SiteBlock":
      return renderBlock(section.props);
    default:
      return renderFallback(section);
  }
}

function renderHero(props: Record<string, unknown>): string {
  const title = str(props.title);
  const subtitle = str(props.subtitle);
  const eyebrow = str(props.eyebrow);
  const cta = props.cta as { label?: string; href?: string } | null | undefined;
  const backgroundImage = props.backgroundImage as string | null | undefined;
  const styleHint = props.styleHint as Record<string, unknown> | undefined;
  const isUppercase = styleHint?.uppercase === true;
  const isBold = styleHint?.bold !== false;
  const align = str(styleHint?.align) || "center";
  const ctaStyle = str(styleHint?.ctaStyle) || "primary";
  const overlayOpacity = typeof styleHint?.overlayOpacity === "number" ? styleHint.overlayOpacity : 0.6;

  const alignClass = align === "left" ? "items-start text-left" : align === "right" ? "items-end text-right" : "items-center text-center";
  const contentClass = align === "left" ? "mx-0 max-w-5xl" : align === "right" ? "ml-auto max-w-5xl" : "mx-auto max-w-5xl";

  const heroTextColor = str(styleHint?.heroTextColor);
  const heroCtaBg = str(styleHint?.heroCtaBg);
  const heroCtaColor = str(styleHint?.heroCtaColor);
  const heroCtaRadius = str(styleHint?.heroCtaRadius);
  const heroCtaHasIcon = styleHint?.heroCtaHasIcon === true;
  const heroCtaUppercase = styleHint?.heroCtaUppercase === true;
  const heroCtaBold = styleHint?.heroCtaBold === true;
  const heroCtaTransform = str(styleHint?.heroCtaTransform);
  const heroCtaPadding = str(styleHint?.heroCtaPadding);
  const subtitleUppercase = styleHint?.subtitleUppercase === true;
  const eyebrowBg = str(styleHint?.eyebrowBg);
  const eyebrowColor = str(styleHint?.eyebrowColor);
  const eyebrowPadding = str(styleHint?.eyebrowPadding);

  const textClass = heroTextColor
    ? ""
    : backgroundImage
      ? "text-white"
      : "text-[var(--color-primary-foreground)]";
  const textStyle = heroTextColor ? `color: ${heroTextColor};` : "";

  const hasExplicitCtaColors = heroCtaBg && heroCtaColor;
  const ctaClass = hasExplicitCtaColors
    ? [
        "mt-8 inline-flex items-center justify-center text-base tracking-wide hover:opacity-90",
        heroCtaUppercase ? "uppercase" : "",
        heroCtaBold ? "font-bold" : "font-semibold",
      ].join(" ")
    : ctaStyle === "dark"
      ? "mt-8 inline-flex items-center justify-center rounded-[var(--radius)] bg-black/60 px-8 py-4 text-base font-bold uppercase tracking-wide text-white hover:bg-black/80"
      : ctaStyle === "outline"
        ? "mt-8 inline-flex items-center justify-center rounded-[var(--radius)] border-2 border-current px-8 py-4 text-base font-bold uppercase tracking-wide hover:opacity-80"
        : "mt-8 inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary)] px-8 py-4 text-base font-bold uppercase tracking-wide text-[var(--color-primary-foreground)] hover:opacity-90";

  const ctaStyleParts = [];
  if (heroCtaBg) ctaStyleParts.push(`background-color: ${heroCtaBg};`);
  if (heroCtaColor) ctaStyleParts.push(`color: ${heroCtaColor};`);
  if (heroCtaTransform) ctaStyleParts.push(`transform: ${heroCtaTransform};`);
  if (heroCtaPadding) ctaStyleParts.push(`padding: ${heroCtaPadding};`);
  if (heroCtaRadius && heroCtaRadius !== "0px") ctaStyleParts.push(`border-radius: ${heroCtaRadius};`);
  const ctaStyleAttr = ctaStyleParts.length > 0 ? `style="${ctaStyleParts.join(" ")}"` : "";

  const iconBlock = heroCtaHasIcon
    ? `<svg class="ml-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
  </svg>`
    : "";

  const ctaBlock =
    cta?.label && cta?.href
      ? `<a href={cta.href} class="${ctaClass}" ${ctaStyleAttr}>
  {cta.label}${iconBlock}
</a>`
      : "";

  const bgStyle = backgroundImage
    ? `style="background-image: url(${backgroundImage}); background-size: cover; background-position: center;"`
    : "";

  const effectiveOverlay = backgroundImage ? Math.max(overlayOpacity, 0.5) : overlayOpacity;
  const overlay = backgroundImage
    ? `<div class="absolute inset-0 bg-black/[${effectiveOverlay}]" aria-hidden="true" />`
    : "";

  const titleClass = [
    "text-4xl tracking-tight sm:text-6xl md:text-7xl text-balance font-[family-name:var(--font-heading)]",
    isUppercase ? "uppercase" : "",
    isBold ? "font-black" : "font-bold",
  ].join(" ");

  const eyebrowStyleParts = [];
  if (eyebrowBg) eyebrowStyleParts.push(`background-color: ${eyebrowBg};`);
  if (eyebrowColor) eyebrowStyleParts.push(`color: ${eyebrowColor};`);
  if (eyebrowPadding) eyebrowStyleParts.push(`padding: ${eyebrowPadding};`);
  const eyebrowStyleAttr = eyebrowStyleParts.length > 0 ? `style="${eyebrowStyleParts.join(" ")}"` : "";

  const eyebrowBlock = eyebrow
    ? `<p class="mb-4 inline-block text-sm font-semibold uppercase tracking-widest font-[family-name:var(--font-body)]" ${eyebrowStyleAttr}>{eyebrow}</p>`
    : "";

  const sectionClass = `relative flex min-h-[70vh] flex-col justify-center bg-[var(--color-primary)] px-6 pb-24 pt-32 ${alignClass} ${textClass} overflow-hidden`;

  return `---
const title = ${json(title)};
const subtitle = ${json(subtitle)};
const eyebrow = ${json(eyebrow)};
const cta = ${json(cta)};
const backgroundImage = ${json(backgroundImage)};
---

<section class="${sectionClass}" ${bgStyle}>
  ${overlay}
  <div class="relative z-10 w-full ${contentClass} px-4" ${textStyle ? `style="${textStyle}"` : ""}>
    ${eyebrowBlock}
    <h1 class="${titleClass}">{title}</h1>
    {subtitle && <p class="mt-6 text-xl opacity-90 ${subtitleUppercase ? "uppercase" : ""} font-[family-name:var(--font-body)]">{subtitle}</p>}
    ${ctaBlock}
  </div>
</section>`;
}

function renderText(props: Record<string, unknown>): string {
  const title = str(props.title);
  const body = str(props.body);
  const align = str(props.align) || "center";
  const imageUrl = str(props.imageUrl);
  const imagePosition = str(props.imagePosition) || "none";
  const alignClass = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center";

  const hasImage = !!imageUrl && imagePosition !== "none";
  const contentClass = hasImage
    ? "grid gap-10 items-center max-w-6xl mx-auto " + (imagePosition === "right" ? "lg:grid-cols-[1fr_1.25fr]" : "lg:grid-cols-[1.25fr_1fr]")
    : "max-w-4xl mx-auto";
  const textOrder = imagePosition === "right" ? "order-2" : "order-1";
  const imageOrder = imagePosition === "right" ? "order-1" : "order-2";

  return `---
const title = ${json(title)};
const body = ${json(body)};
const imageUrl = ${json(imageUrl)};
---

<section class="py-20 px-6 bg-[var(--color-background)] text-[var(--color-foreground)] ${alignClass}">
  <div class="${contentClass}">
    {imageUrl && (
      <img
        src={imageUrl}
        alt={title || ""}
        class="${imageOrder} w-full rounded-[var(--radius)] object-cover max-h-[28rem]"
        loading="lazy"
      />
    )}
    <div class="${hasImage ? textOrder : ""}">
      {title && <h2 class="text-3xl font-black uppercase tracking-tight font-[family-name:var(--font-heading)]">{title}</h2>}
      {body && <p class="mt-6 text-lg whitespace-pre-line font-[family-name:var(--font-body)]">{body}</p>}
    </div>
  </div>
</section>`;
}

function renderCardGroup(props: Record<string, unknown>): string {
  const title = str(props.title);
  const subtitle = str(props.subtitle);
  const layout = str(props.layout) || "grid";
  const imageStyle = str(props.imageStyle) || "top";
  const cards = array<{ title?: string; description?: string; imageUrl?: string }>(props.cards);
  const backgroundImage = str(props.backgroundImage);

  const gridCols =
    layout === "row"
      ? "grid gap-6 sm:grid-cols-2"
      : cards.length >= 6
        ? "grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        : cards.length === 5
          ? "grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
          : cards.length >= 3
            ? "grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            : "grid gap-6 sm:grid-cols-2";

  const hasBgImage = !!backgroundImage;
  const sectionBase = hasBgImage
    ? "relative py-20 px-6 text-white"
    : "relative py-20 px-6 bg-[var(--color-background)] text-[var(--color-foreground)]";
  const bgStyle = backgroundImage
    ? `style="background-image: url(${backgroundImage}); background-size: cover; background-position: center;"`
    : "";
  const overlay = backgroundImage
    ? `<div class="absolute inset-0 bg-black/70" aria-hidden="true" />`
    : "";

  const isIconStyle = imageStyle === "icon";
  const isBackgroundStyle = imageStyle === "background";

  const cardClass = isBackgroundStyle
    ? "relative rounded-[var(--radius)] overflow-hidden min-h-[18rem] flex items-end p-6"
    : isIconStyle
      ? "rounded-[var(--radius)] p-6 text-center bg-[var(--color-muted)]"
      : "rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] overflow-hidden";

  const bodyClass = "text-[var(--color-muted-foreground)]";
  const titleClass = `text-xl font-bold ${isIconStyle ? "" : "font-[family-name:var(--font-heading)]"}`;

  return `---
const title = ${json(title)};
const subtitle = ${json(subtitle)};
const cards = ${json(cards)};
const backgroundImage = ${json(backgroundImage)};
---

<section class="${sectionBase}" ${bgStyle}>
  ${overlay}
  <div class="relative z-10 max-w-6xl mx-auto">
    {title && <h2 class="text-3xl font-black uppercase tracking-tight text-center mb-6 font-[family-name:var(--font-heading)]">{title}</h2>}
    {subtitle && <p class="max-w-3xl mx-auto mb-12 text-center text-lg ${bodyClass} font-[family-name:var(--font-body)]">{subtitle}</p>}
    <div class="${gridCols}">
      {cards.map((card) => (
        <div class="${cardClass}">
          ${isBackgroundStyle ? `{card.imageUrl && (
            <>
              <img
                src={card.imageUrl}
                alt={card.title || ""}
                class="absolute inset-0 w-full h-full ${isSvgUrl("{card.imageUrl}") ? "object-contain p-10" : "object-cover"}"
                loading="lazy"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" aria-hidden="true" />
            </>
          )}` : ""}
          ${isIconStyle ? `{card.imageUrl && <img src={card.imageUrl} alt={card.title || ""} class="mx-auto mb-4 h-24 w-24 object-contain" loading="lazy" />}` : ""}
          ${!isBackgroundStyle && !isIconStyle ? `{card.imageUrl && <img src={card.imageUrl} alt={card.title || ""} class="w-full h-52 object-cover" loading="lazy" />}` : ""}
          <div class="${isBackgroundStyle ? "relative z-10" : ""} ${isIconStyle ? "" : "p-6"}">
            {card.title && <h3 class="${titleClass} ${isBackgroundStyle ? "text-white" : "text-[var(--color-foreground)]"}">{card.title}</h3>}
            {card.description && <p class="mt-2 ${isBackgroundStyle ? "text-white/80" : bodyClass} font-[family-name:var(--font-body)]">{card.description}</p>}
          </div>
        </div>
      ))}
    </div>
  </div>
</section>`;
}

function renderReviews(props: Record<string, unknown>): string {
  const title = str(props.title);
  const reviews = array<{ quote?: string; author?: string }>(props.reviews);
  const widgetUrl = str(props.widgetUrl);

  if (widgetUrl) {
    return `---
const title = ${json(title)};
const widgetUrl = ${json(widgetUrl)};
---

<section class="py-16 px-6 bg-[var(--color-muted)] text-[var(--color-foreground)]">
  <div class="max-w-5xl mx-auto text-center">
    {title && <h2 class="text-3xl font-bold mb-10 font-[family-name:var(--font-heading)]">{title}</h2>}
    <iframe
      src={widgetUrl}
      class="w-full"
      style="min-width: 100%; width: 100%;"
      height="529"
      frameborder="0"
      scrolling="no"
      title={title || "Reviews"}
      loading="lazy"
    />
  </div>
</section>`;
  }

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

function renderSteps(props: Record<string, unknown>): string {
  const title = str(props.title);
  const steps = array<{ title?: string; description?: string; imageUrl?: string }>(props.steps ?? props.cards);

  return `---
const title = ${json(title)};
const steps = ${json(steps)};
---

<section class="py-20 px-6 bg-[var(--color-background)] text-[var(--color-foreground)]">
  <div class="max-w-6xl mx-auto">
    {title && <h2 class="text-3xl font-black uppercase tracking-tight text-center mb-12 font-[family-name:var(--font-heading)]">{title}</h2>}
    <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {steps.map((step, idx) => (
        <div class="relative rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] p-6">
          <span class="absolute -top-3 left-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-bold text-[var(--color-primary-foreground)]">
            {idx + 1}
          </span>
          {step.imageUrl && <img src={step.imageUrl} alt={step.title || ""} class="mb-4 h-12 w-12 object-contain" loading="lazy" />}
          {step.title && <h3 class="mt-4 text-xl font-bold font-[family-name:var(--font-heading)]">{step.title}</h3>}
          {step.description && <p class="mt-2 text-[var(--color-muted-foreground)] font-[family-name:var(--font-body)]">{step.description}</p>}
        </div>
      ))}
    </div>
  </div>
</section>`;
}

function renderBlock(props: Record<string, unknown>): string {
  const title = str(props.title);
  const body = str(props.body);
  const layout = str(props.layout) || "default";
  const images = array<string>(props.images);
  const items = array<{ title?: string; description?: string }>(props.items);
  const align = str(props.align) || "center";

  const gallery = layout === "gallery" && images.length > 0
    ? `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
        {images.map((img) => (
          <img src={img} alt="" class="w-full h-64 object-cover rounded-[var(--radius)]" loading="lazy" />
        ))}
      </div>`
    : "";

  const faq = layout === "faq" && items.length > 0
    ? `<div class="max-w-3xl mx-auto text-left">
        {items.map((item, idx) => (
          <details class="group border-b border-[var(--color-border)]">
            <summary class="flex cursor-pointer items-center justify-between py-6 text-lg font-bold font-[family-name:var(--font-heading)] list-none">
              {item.title}
              <svg class="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            {item.description && <p class="pb-6 text-[var(--color-muted-foreground)] font-[family-name:var(--font-body)]">{item.description}</p>}
          </details>
        ))}
      </div>`
    : "";

  return `---
const title = ${json(title)};
const body = ${json(body)};
const images = ${json(images)};
const items = ${json(items)};
---

<section class="py-20 px-6 bg-[var(--color-background)] text-[var(--color-foreground)] ${align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"}">
  <div class="max-w-6xl mx-auto">
    {title && <h2 class="text-3xl font-black uppercase tracking-tight mb-6 font-[family-name:var(--font-heading)]">{title}</h2>}
    {body && <p class="max-w-3xl mx-auto text-lg whitespace-pre-line font-[family-name:var(--font-body)]">{body}</p>}
    ${gallery}
    ${faq}
  </div>
</section>`;
}

function renderCTA(props: Record<string, unknown>): string {
  const title = str(props.title);
  const subtitle = str(props.subtitle);
  const cta = props.cta as { label?: string; href?: string } | null | undefined;
  const backgroundImage = str(props.backgroundImage);

  const bgStyle = backgroundImage
    ? `style="background-image: url(${backgroundImage}); background-size: cover; background-position: center;"`
    : "";
  const overlay = backgroundImage
    ? `<div class="absolute inset-0 bg-black/60" aria-hidden="true" />`
    : "";

  return `---
const title = ${json(title)};
const subtitle = ${json(subtitle)};
const cta = ${json(cta)};
const backgroundImage = ${json(backgroundImage)};
---

<section class="relative py-20 px-6 ${backgroundImage ? "text-white" : "bg-[var(--color-muted)] text-[var(--color-foreground)]"} text-center overflow-hidden" ${bgStyle}>
  ${overlay}
  <div class="relative z-10 max-w-4xl mx-auto">
    {title && <h2 class="text-3xl font-black uppercase tracking-tight sm:text-5xl font-[family-name:var(--font-heading)]">{title}</h2>}
    {subtitle && <p class="mt-4 text-lg opacity-90 font-[family-name:var(--font-body)]">{subtitle}</p>}
    {cta?.label && cta?.href && (
      <a
        href={cta.href}
        class="mt-8 inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary)] px-8 py-4 text-base font-bold uppercase tracking-wide text-[var(--color-primary-foreground)] hover:opacity-90"
      >
        {cta.label}
      </a>
    )}
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
    {address && address !== title && <p class="text-lg whitespace-pre-line font-[family-name:var(--font-body)]">{address}</p>}
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
  const logo = props.logo as { type?: string; value?: string; alt?: string } | null | undefined;
  const navLinks = array<{ label?: string; href?: string }>(props.navLinks);
  const ctaLabel = str(props.ctaLabel);
  const ctaHref = str(props.ctaHref);
  const variant = str(props.variant);
  const isTransparent = variant === "transparent";
  const style = props.headerCtaStyle as {
    bg?: string;
    color?: string;
    radius?: string;
    padding?: string;
    uppercase?: boolean;
    bold?: boolean;
    light?: boolean;
    fontSize?: string;
  } | undefined;

  const ctaStyleEntries: [string, string][] = [];
  if (style?.bg) ctaStyleEntries.push(["backgroundColor", style.bg]);
  if (style?.color) ctaStyleEntries.push(["color", style.color]);
  if (style?.radius) ctaStyleEntries.push(["borderRadius", style.radius]);
  if (style?.padding) ctaStyleEntries.push(["padding", style.padding]);
  if (style?.fontSize) ctaStyleEntries.push(["fontSize", style.fontSize]);
  const ctaStyleObject = ctaStyleEntries.length > 0 ? Object.fromEntries(ctaStyleEntries) : undefined;

  const ctaClass = ctaStyleObject
    ? [
        "shrink-0",
        "inline-flex",
        "items-center",
        "justify-center",
        "whitespace-nowrap",
        style?.uppercase ? "uppercase" : "",
        style?.bold ? "font-bold" : style?.light ? "font-light" : "font-medium",
      ].filter(Boolean).join(" ")
    : "shrink-0 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] hover:opacity-90";

  return `---
const logo = ${json(logo)};
const navLinks = ${json(navLinks)};
const ctaLabel = ${json(ctaLabel)};
const ctaHref = ${json(ctaHref)};
const ctaStyle = ${json(ctaStyleObject)};
---

<header class="${isTransparent ? "absolute top-0 left-0 right-0 z-50 bg-transparent border-none text-white" : "sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)]"}">
  <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
    <a href="/" class="flex shrink-0 items-center text-xl font-bold font-[family-name:var(--font-heading)]">
      {logo?.type === "image" && logo?.value ? (
        <img src={logo.value} alt={logo.alt || ""} class="max-h-10 w-auto max-w-[200px] object-contain" />
      ) : (
        <span class="truncate">{logo?.value ?? ""}</span>
      )}
    </a>
    <nav class="hidden min-w-0 items-center gap-4 lg:flex">
      {navLinks.slice(0, 6).map((link) => (
        <a href={link.href} class="truncate text-sm font-medium ${isTransparent ? "hover:text-white/80" : "hover:text-[var(--color-primary)]"}">
          {link.label}
        </a>
      ))}
    </nav>
    {ctaHref && ctaLabel && (
      <a
        href={ctaHref}
        class="${ctaClass}"${ctaStyleObject ? " style={ctaStyle}" : ""}
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
