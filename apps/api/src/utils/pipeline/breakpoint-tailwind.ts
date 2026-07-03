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

  // Fallback: describe the change so the LLM can pick appropriate classes.
  const stops = [
    d.at375 ? `${d.at375} at 375px` : null,
    d.at768 ? `${d.at768} at 768px` : null,
    `${d.at1440} at 1440px`,
  ]
    .filter((s): s is string => s !== null)
    .join(", ");
  return `${d.property} changes across breakpoints: ${stops} — pick matching responsive utilities`;
}
