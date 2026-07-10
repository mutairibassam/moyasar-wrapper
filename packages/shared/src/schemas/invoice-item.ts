import { z } from "zod";

const isoDateTime = z.union([
  z.iso.datetime({ offset: true }),
  z.iso.datetime(),
  z.iso.date(),
]);

const httpUrl = z
  .url()
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
    message: "URL must use http or https",
  });

export const invoiceItemInputSchema = z.object({
  amount: z
    .number()
    .int("Amount must be an integer in minor units (halalas)")
    .min(100, "Moyasar minimum amount is 100 minor units"),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO-4217 code")
    .transform((c) => c.toUpperCase()),
  description: z.string().trim().min(1).max(255),
  expiredAt: isoDateTime.optional(),
  callbackUrl: httpUrl.optional(),
  successUrl: httpUrl.optional(),
  backUrl: httpUrl.optional(),
  metadata: z
    .record(z.string().min(1).max(50), z.string().max(500))
    .optional(),
});

export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;
