import { z } from "zod";
import { MOYASAR_INVOICE_STATUSES } from "../enums";

export const invoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(MOYASAR_INVOICE_STATUSES).optional(),
  batchId: z.uuid().optional(),
  createdAfter: z.iso.datetime().optional(),
  createdBefore: z.iso.datetime().optional(),
});
export type InvoicesQuery = z.infer<typeof invoicesQuerySchema>;
