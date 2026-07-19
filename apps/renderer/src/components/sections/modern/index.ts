// Modern template component map — hand-crafted + adapt-generated
import type { AstroComponent } from "../../../lib/template-resolver";

import Hero             from "./Hero.astro";
import CoreValues       from "./CoreValues.astro";
import Programs         from "./Programs.astro";
import HowItWorks       from "./HowItWorks.astro";
import Testimonials     from "./Testimonials.astro";
import Amenities        from "./Amenities.astro";
import Community        from "./Community.astro";
import Location         from "./Location.astro";
import FAQ              from "./FAQ.astro";
import CTABand          from "./CTABand.astro";
import HeroCenter       from "./HeroCenter.astro";
import ProgramCardsSticky from "./ProgramCardsSticky.astro";

export const COMPONENT_MAP: Record<string, AstroComponent> = {
  hero:               Hero as unknown as AstroComponent,
  Hero:               Hero as unknown as AstroComponent,
  coreValues:         CoreValues as unknown as AstroComponent,
  CoreValues:         CoreValues as unknown as AstroComponent,
  programs:           Programs as unknown as AstroComponent,
  Programs:           Programs as unknown as AstroComponent,
  howItWorks:         HowItWorks as unknown as AstroComponent,
  HowItWorks:         HowItWorks as unknown as AstroComponent,
  testimonials:       Testimonials as unknown as AstroComponent,
  Testimonials:       Testimonials as unknown as AstroComponent,
  amenities:          Amenities as unknown as AstroComponent,
  Amenities:          Amenities as unknown as AstroComponent,
  community:          Community as unknown as AstroComponent,
  Community:          Community as unknown as AstroComponent,
  location:           Location as unknown as AstroComponent,
  Location:           Location as unknown as AstroComponent,
  faq:                FAQ as unknown as AstroComponent,
  FAQ:                FAQ as unknown as AstroComponent,
  ctaBand:            CTABand as unknown as AstroComponent,
  CTABand:            CTABand as unknown as AstroComponent,
  HeroCenter:         HeroCenter as unknown as AstroComponent,
  ProgramCardsSticky: ProgramCardsSticky as unknown as AstroComponent,
};
