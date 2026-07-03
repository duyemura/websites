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
  trigger: "click" | "hover";
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
}

export interface SectionVisualEvidence {
  version: "1";
  rows: SectionVisualEvidenceRow[];
}
