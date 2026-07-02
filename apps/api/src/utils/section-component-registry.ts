import type { SiteSection } from "@ploy-gyms/shared-types";

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function renderSemanticSection(section: SiteSection): string {
  switch (section.type) {
    case "Hero":
      return renderHero(section.props);
    case "SiteHeader":
      return renderHeader(section.props);
    case "SiteFooter":
      return renderFooter(section.props);
    default:
      throw new Error(`Non-semantic section type cannot be rendered by shell renderer: ${section.type}`);
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

function renderHeader(props: Record<string, unknown>): string {
  const logo = props.logo as { type?: string; value?: string; alt?: string } | null | undefined;
  const navLinks = (props.navLinks ?? []) as { label?: string; href?: string }[];
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
  const navLinks = (props.navLinks ?? []) as { label?: string; href?: string }[];
  const socialLinks = props.socialLinks as { platform?: string; url?: string }[] | { label?: string; href?: string }[] | undefined;
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
      {socialLinks?.map((social) => {
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
