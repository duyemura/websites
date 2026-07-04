import type { BreakpointDelta } from "../../types/pipeline-artifacts";

export interface TailwindInstruction {
  selector: string;
  instruction: string;
}

export function breakpointDeltasToTailwind(deltas: BreakpointDelta[]): TailwindInstruction[] {
  return deltas.map((d) => ({ selector: d.selector, instruction: mapDelta(d) }));
}

function cols(value: string | undefined): string {
  if (!value) return "1";
  const match = value.match(/repeat\((\d+)/);
  if (match && match[1]) return match[1];
  const parts = value.split(" ").filter(Boolean);
  return parts.length > 0 ? parts.length.toString() : "1";
}

function pxToTailwindArbitrary(value: string): string {
  // Convert a CSS value to a Tailwind arbitrary value string, e.g. "-33px" → "[-33px]"
  return `[${value}]`;
}

function mapSpacingDelta(prop: string, d: BreakpointDelta): string {
  const mobile = d.at375 ?? d.at768;
  const prefix = prop === "padding" ? "p" : "m";
  const mobileClass = mobile ? `${prefix}-${pxToTailwindArbitrary(mobile)}` : "";
  const desktopClass = `md:${prefix}-${pxToTailwindArbitrary(d.at1440)}`;
  if (!mobile || mobile === d.at1440) return `use \`${prefix}-${pxToTailwindArbitrary(d.at1440)}\``;
  return `use \`${mobileClass} ${desktopClass}\` (${prop} changes at 768px breakpoint)`;
}

function mapDelta(d: BreakpointDelta): string {
  const mobile = d.at375 ?? d.at768;

  if (d.property === "flex-direction" && d.at1440 === "row" && mobile === "column") {
    return "use `flex-col md:flex-row` (stacks vertically below 768px)";
  }
  if (d.property === "flex-direction" && d.at1440 === "column" && mobile === "row") {
    return "use `flex-row md:flex-col`";
  }
  if (d.property === "display" && mobile === "none") {
    const desktopClass =
      d.at1440 === "flex" ? "md:flex" : d.at1440 === "grid" ? "md:grid" : "md:block";
    return `use \`hidden ${desktopClass}\` (hidden below 768px)`;
  }
  if (d.property === "display" && d.at1440 === "none") {
    return "use `block md:hidden` (mobile-only element)";
  }
  if (d.property === "grid-template-columns") {
    const smallest = d.at375 ?? d.at768;
    const parts: string[] = [`grid-cols-${cols(smallest)}`];
    if (d.at768 && d.at375 && d.at768 !== d.at375) {
      parts.push(`md:grid-cols-${cols(d.at768)}`);
    }
    const desktopPrefix = d.at768 ? "lg" : "md";
    parts.push(`${desktopPrefix}:grid-cols-${cols(d.at1440)}`);
    return `use \`${parts.join(" ")}\``;
  }
  if (d.property === "padding" || d.property === "margin") {
    return mapSpacingDelta(d.property, d);
  }
  if (d.property === "width" || d.property === "max-width" || d.property === "min-width") {
    const abbr = d.property === "width" ? "w" : d.property === "max-width" ? "max-w" : "min-w";
    if (!mobile || mobile === d.at1440) return `use \`${abbr}-${pxToTailwindArbitrary(d.at1440)}\``;
    return `use \`${abbr}-${pxToTailwindArbitrary(mobile)} md:${abbr}-${pxToTailwindArbitrary(d.at1440)}\``;
  }
  if (d.property === "height" || d.property === "min-height") {
    const abbr = d.property === "height" ? "h" : "min-h";
    if (!mobile || mobile === d.at1440) return `use \`${abbr}-${pxToTailwindArbitrary(d.at1440)}\``;
    return `use \`${abbr}-${pxToTailwindArbitrary(mobile)} md:${abbr}-${pxToTailwindArbitrary(d.at1440)}\``;
  }
  if (d.property === "gap" || d.property === "column-gap" || d.property === "row-gap") {
    const abbr = d.property === "gap" ? "gap" : d.property === "column-gap" ? "gap-x" : "gap-y";
    if (!mobile || mobile === d.at1440) return `use \`${abbr}-${pxToTailwindArbitrary(d.at1440)}\``;
    return `use \`${abbr}-${pxToTailwindArbitrary(mobile)} md:${abbr}-${pxToTailwindArbitrary(d.at1440)}\``;
  }
  if (d.property === "font-size") {
    if (!mobile || mobile === d.at1440) return `use \`text-[${d.at1440}]\``;
    return `use \`text-[${mobile}] md:text-[${d.at1440}]\``;
  }

  // Fallback: give explicit arbitrary-value Tailwind syntax so the LLM has a concrete hint.
  const stops = [
    d.at375 ? `${d.at375} at 375px` : null,
    d.at768 ? `${d.at768} at 768px` : null,
    `${d.at1440} at 1440px`,
  ]
    .filter((s): s is string => s !== null)
    .join(", ");
  return `${d.property} changes: ${stops} — use Tailwind arbitrary values e.g. \`[value] md:[value]\``;
}
