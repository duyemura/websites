import { describe, expect, it } from "vitest";
import { breakpointDeltasToTailwind } from "../breakpoint-tailwind";

describe("breakpointDeltasToTailwind", () => {
  it("maps flex-direction row->column to responsive flex classes", () => {
    const out = breakpointDeltasToTailwind([
      { selector: ".features", property: "flex-direction", at1440: "row", at375: "column" },
    ]);
    expect(out).toContainEqual({
      selector: ".features",
      instruction: "use `flex-col md:flex-row` (stacks vertically below 768px)",
    });
  });

  it("maps display none at mobile to hidden/visible classes", () => {
    const out = breakpointDeltasToTailwind([
      { selector: "nav.desktop", property: "display", at1440: "flex", at375: "none" },
    ]);
    expect(out).toContainEqual({
      selector: "nav.desktop",
      instruction: "use `hidden md:flex` (hidden below 768px)",
    });
  });

  it("maps grid column count changes", () => {
    const out = breakpointDeltasToTailwind([
      { selector: ".cards", property: "grid-template-columns", at1440: "repeat(3, 1fr)", at768: "repeat(2, 1fr)", at375: "repeat(1, 1fr)" },
    ]);
    expect(out[0].instruction).toContain("grid-cols-1 md:grid-cols-2 lg:grid-cols-3");
  });

  it("falls back to a descriptive instruction for unmapped properties", () => {
    const out = breakpointDeltasToTailwind([
      { selector: "h1", property: "font-size", at1440: "64px", at375: "32px" },
    ]);
    expect(out[0].instruction).toContain("font-size");
    expect(out[0].instruction).toContain("32px");
    expect(out[0].instruction).toContain("64px");
  });
});
