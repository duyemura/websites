import { content } from "./content";

/** All indexable routes — excludes legal, 404, and preview-suppressed content. */
export function publicRoutes(): string[] {
  const { pages } = content;
  return [
    "/",
    ...pages.programs.map((p) => `/programs/${p.slug}`),
    "/about",
    "/pricing",
    "/contact",
    "/schedule",
    "/blog",
    ...pages.blog.posts.map((p) => `/blog/${p.slug}`),
    ...(pages.localGuide ? ["/local-guide"] : []),
  ];
}
