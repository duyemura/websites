import { z } from "zod";

const base = {
  pageGlob: z.string().min(1).max(300),
  author: z.enum(["agent", "human"]).default("human"),
};

/** The seven allowed transform types — everything else is rejected at the API (edit clamp). */
export const CreateTransformSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("meta-set"),
    selector: z.undefined().or(z.null()).optional(),
    payload: z
      .object({
        title: z.string().optional(),
        name: z.string().optional(),
        property: z.string().optional(),
        content: z.string().optional(),
      })
      .refine(
        (p) =>
          p.title !== undefined ||
          ((p.name !== undefined || p.property !== undefined) && p.content !== undefined),
        { message: "meta-set needs title, or name/property + content" },
      ),
  }),
  z.object({
    ...base,
    type: z.literal("jsonld-inject"),
    selector: z.undefined().or(z.null()).optional(),
    payload: z.object({ json: z.record(z.unknown()) }),
  }),
  z.object({
    ...base,
    type: z.literal("head-inject"),
    selector: z.undefined().or(z.null()).optional(),
    payload: z.object({ html: z.string().max(5_000) }),
  }),
  z.object({
    ...base,
    type: z.literal("text-replace"),
    selector: z.string().min(1),
    payload: z.object({ find: z.string().min(1), replace: z.string() }),
  }),
  z.object({
    ...base,
    type: z.literal("attr-set"),
    selector: z.string().min(1),
    payload: z.object({ attr: z.string().min(1).max(100), value: z.string() }),
  }),
  z.object({
    ...base,
    type: z.literal("form-route"),
    selector: z.string().min(1),
    payload: z.object({ action: z.string().min(1) }),
  }),
  z.object({
    ...base,
    type: z.literal("page-replace"),
    selector: z.undefined().or(z.null()).optional(),
    payload: z.object({ artifactRef: z.string().min(1) }),
  }),
]);

export type CreateTransformInput = z.infer<typeof CreateTransformSchema>;

export const UpdateTransformSchema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  ordinal: z.number().int().optional(),
});
