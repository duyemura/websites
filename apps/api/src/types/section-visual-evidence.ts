export interface ComputedStyleSnapshot {
  selector: string;
  tagName: string;
  className?: string;
  backgroundColor?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  textTransform?: string;
  textAlign?: string;
  lineHeight?: string;
  letterSpacing?: string;
  borderRadius?: string;
  padding?: string;
  margin?: string;
  boxShadow?: string;
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
}

export type InteractionComponentPattern =
  | "dropdown"
  | "accordion"
  | "tab"
  | "modal"
  | "drawer"
  | "tooltip"
  | "other";

export interface InteractionEvidenceCapture {
  /**
   * Stable id from the source InteractionCapture in the extract artifact.
   * Optional for backwards compat with older evidence rows that predate
   * this field; new rows written by the pipeline always populate it.
   */
  id?: string;
  trigger: "click" | "hover";
  /** CSS selector of the element that triggers this interaction (e.g. "div.dropdown").
   *  Used in the build prompt so the LLM uses the exact class, and in verify
   *  so the replay checker can find it in the clone. */
  triggerSelector?: string;
  beforeUrl: string;
  afterUrl: string;
  styleDiff: Array<{
    selector: string;
    property: string;
    before: string;
    after: string;
  }>;
  componentPattern?: InteractionComponentPattern;
}

export interface SectionVisualEvidenceRow {
  evidenceId: string;
  pageSlug: string;
  sectionId: string;
  screenshotUrl?: string;
  /** Mobile (375px viewport) crop of the section. */
  mobileScreenshotUrl?: string;
  contextScreenshotUrl?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  computedStyles: ComputedStyleSnapshot[];
  domSnippet?: string;
  layoutHint?: {
    theme?: "dark" | "light";
    centered?: boolean;
    columns?: number;
    imagePosition?: "left" | "right" | "background" | "none";
    align?: "left" | "center" | "right";
    hasBackgroundImage?: boolean;
    hasBorder?: boolean;
    hasOverlay?: boolean;
  };
  mediaUrls?: string[];
  interactionCaptures?: InteractionEvidenceCapture[];
  /** Computed CSS values extracted from the live DOM during segment stage.
   *  Exact values from getComputedStyle — no guessing from screenshots needed. */
  domStyles?: {
    containerBackground?: string;
    containerBackgroundImage?: string;
    overlayBackground?: string;
    headingFontSize?: string;
    headingFontWeight?: string;
    headingColor?: string;
    headingTextTransform?: string;
    ctaBackground?: string;
    ctaColor?: string;
    ctaBorderRadius?: string;
    ctaPositionSide?: "left" | "right" | "center";
    flexDirection?: string;
    textAlign?: string;
    padding?: string;
  };
}

export interface SectionVisualEvidence {
  version: "1";
  rows: SectionVisualEvidenceRow[];
}
