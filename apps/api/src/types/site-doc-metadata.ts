export interface SiteDocMetadata {
  framework: "astro";
  mode: "replication" | "template" | "greenfield";
  targetUrl?: string;
  businessName?: string;
  generatedAt: string;
}
