import { z } from "zod";

export const moyasarInvoiceSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number(),
  currency: z.string(),
  description: z.string(),
  url: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.string()).optional().nullable(),
});
export type MoyasarInvoice = z.infer<typeof moyasarInvoiceSchema>;

export const bulkResponseSchema = z.object({ invoices: z.array(moyasarInvoiceSchema) });
export const listResponseSchema = z.object({
  invoices: z.array(moyasarInvoiceSchema),
  meta: z.object({ current_page: z.number(), next_page: z.number().nullable() }).optional(),
});

export type BulkInvoiceInput = {
  amount: number;
  currency: string;
  description: string;
  expired_at?: string;
  success_url?: string;
  back_url?: string;
  callback_url?: string;
  metadata: Record<string, string>;
};
