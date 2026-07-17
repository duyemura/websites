// apps/renderer/src/components/sections/beanburito/index.ts
// Component map for the beanburito theme. Imported dynamically by PageRenderer
// via import.meta.glob so new templates can add their own folder without editing
// page files.

import type { AstroComponent } from "../../../lib/template-resolver";

import Hero from "./Hero.astro";
import Programs from "./Programs.astro";
import Location from "./Location.astro";
import Benefits from "./Benefits.astro";
import CTABand from "./CTABand.astro";
import HowItWorks from "./HowItWorks.astro";
import Amenities from "./Amenities.astro";
import Community from "./Community.astro";
import Testimonials from "./Testimonials.astro";
import FAQ from "./FAQ.astro";
import IframeBand from "./IframeBand.astro";
import WhatIsIt from "./WhatIsIt.astro";
import WhatToExpect from "./WhatToExpect.astro";
import BlogGrid from "./BlogGrid.astro";
import Story from "./Story.astro";
import CoachList from "./CoachList.astro";

import IconCardGrid from "../IconCardGrid.astro";
import PricingGrid from "../PricingGrid.astro";
import RichContent from "../RichContent.astro";
import TeamGrid from "../TeamGrid.astro";

export const COMPONENT_MAP: Record<string, AstroComponent> = {
  Hero: Hero as unknown as AstroComponent,
  hero: Hero as unknown as AstroComponent,
  Programs: Programs as unknown as AstroComponent,
  programs: Programs as unknown as AstroComponent,
  Location: Location as unknown as AstroComponent,
  location: Location as unknown as AstroComponent,
  Benefits: Benefits as unknown as AstroComponent,
  benefits: Benefits as unknown as AstroComponent,
  IconCardGrid: IconCardGrid as unknown as AstroComponent,
  iconCardGrid: IconCardGrid as unknown as AstroComponent,
  CTABand: CTABand as unknown as AstroComponent,
  ctaBand: CTABand as unknown as AstroComponent,
  valueProps: Benefits as unknown as AstroComponent,
  HowItWorks: HowItWorks as unknown as AstroComponent,
  howItWorks: HowItWorks as unknown as AstroComponent,
  Amenities: Amenities as unknown as AstroComponent,
  amenities: Amenities as unknown as AstroComponent,
  Community: Community as unknown as AstroComponent,
  community: Community as unknown as AstroComponent,
  Testimonials: Testimonials as unknown as AstroComponent,
  testimonials: Testimonials as unknown as AstroComponent,
  FAQ: FAQ as unknown as AstroComponent,
  faq: FAQ as unknown as AstroComponent,
  IframeBand: IframeBand as unknown as AstroComponent,
  iframeBand: IframeBand as unknown as AstroComponent,
  WhatIsIt: WhatIsIt as unknown as AstroComponent,
  whatIsIt: WhatIsIt as unknown as AstroComponent,
  WhatToExpect: WhatToExpect as unknown as AstroComponent,
  whatToExpect: WhatToExpect as unknown as AstroComponent,
  BlogGrid: BlogGrid as unknown as AstroComponent,
  blogGrid: BlogGrid as unknown as AstroComponent,
  PricingGrid: PricingGrid as unknown as AstroComponent,
  pricingGrid: PricingGrid as unknown as AstroComponent,
  RichContent: RichContent as unknown as AstroComponent,
  richContent: RichContent as unknown as AstroComponent,
  Story: Story as unknown as AstroComponent,
  story: Story as unknown as AstroComponent,
  TeamGrid: TeamGrid as unknown as AstroComponent,
  team: TeamGrid as unknown as AstroComponent,
  teamBeanburito: CoachList as unknown as AstroComponent,
};
