import { z } from "zod";
import { BATCH_STATUSES } from "../enums";
import { invoiceItemInputSchema } from "./invoice-item";

export const createBatchSchema = z.object({
  name: z.string().trim().min(1).max(160),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO-4217 code")
    .transform((c) => c.toUpperCase()),
});
export type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const replaceItemsSchema = z.object({
  items: z.array(invoiceItemInputSchema).max(1000, "A batch may hold at most 1000 items"),
});
export type ReplaceItemsInput = z.infer<typeof replaceItemsSchema>;

export const rejectBatchSchema = z.object({
  comment: z.string().trim().min(1, "A rejection comment is required").max(1000),
});
export type RejectBatchInput = z.infer<typeof rejectBatchSchema>;

export const listBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(BATCH_STATUSES).optional(),
});
export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
