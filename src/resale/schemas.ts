import { z } from "zod";

export const conditionGradeSchema = z.enum(["LIKE_NEW", "GOOD", "FAIR", "WORN"]);

export const photoChecklistSchema = z
  .object({
    front: z.boolean(),
    back: z.boolean(),
    detail: z.boolean(),
    components: z.boolean(),
  })
  .strict();

const nullableTrimmedNote = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .transform((value) => (value === "" ? null : value));

const nullableAskingPrice = z.number().int().min(1).nullable().optional();

export const resaleDraftPatchSchema = z
  .object({
    conditionGrade: conditionGradeSchema.optional(),
    defectNote: nullableTrimmedNote,
    askingPrice: nullableAskingPrice,
    photoChecklist: photoChecklistSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one resale field is required");

export type ResaleDraftPatchInput = z.input<typeof resaleDraftPatchSchema>;
export type ParsedResaleDraftPatch = z.output<typeof resaleDraftPatchSchema>;

export type ResalePhotoChecklist = z.infer<typeof photoChecklistSchema>;
