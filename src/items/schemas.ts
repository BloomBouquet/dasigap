import { z } from "zod";

const MILLISECONDS_PER_DAY = 86_400_000;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCalendarDate(value: string): Date | null {
  if (!CALENDAR_DATE.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

const purchaseDateSchema = z
  .string()
  .trim()
  .refine((value) => parseCalendarDate(value) !== null, "Invalid calendar date")
  .transform((value) => parseCalendarDate(value) as Date)
  .refine(
    (date) => date.getTime() <= Date.now() + MILLISECONDS_PER_DAY,
    "Purchase date cannot be more than one day in the future",
  );

const requiredName = (max: number) => z.string().trim().min(1).max(max);
const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value === "" ? null : value));

export const createItemSchema = z
  .object({
    name: requiredName(120),
    category: requiredName(60),
    brand: optionalText,
    modelName: optionalText,
    storeName: optionalText,
    purchasePrice: z.number().int().min(1),
    purchaseDate: purchaseDateSchema,
  })
  .strict();

export const updateItemSchema = createItemSchema.partial();

export type CreateItemInput = z.input<typeof createItemSchema>;
export type UpdateItemInput = z.input<typeof updateItemSchema>;
export type ParsedCreateItemInput = z.output<typeof createItemSchema>;
export type ParsedUpdateItemInput = z.output<typeof updateItemSchema>;
