import type { AstroComponent } from "../../../lib/template-resolver";

import Unknown from "./Unknown.astro";
import HeroCenter from "./HeroCenter.astro";
import FeatureGridEven from "./FeatureGridEven.astro";
import FeatureGridEvenFeatureGrid from "./FeatureGridEvenFeatureGrid.astro";
import ProgramCardsSticky from "./ProgramCardsSticky.astro";
import CtaBand from "./CtaBand.astro";
import DarkFeatureGrid from "./DarkFeatureGrid.astro";

export const COMPONENT_MAP: Record<string, AstroComponent> = {
  "Unknown": Unknown as unknown as AstroComponent,
  "HeroCenter": HeroCenter as unknown as AstroComponent,
  "FeatureGridEven": FeatureGridEven as unknown as AstroComponent,
  "FeatureGridEvenFeatureGrid": FeatureGridEvenFeatureGrid as unknown as AstroComponent,
  "ProgramCardsSticky": ProgramCardsSticky as unknown as AstroComponent,
  "CtaBand": CtaBand as unknown as AstroComponent,
  "DarkFeatureGrid": DarkFeatureGrid as unknown as AstroComponent,
};
