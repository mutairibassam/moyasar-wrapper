import { describe, expect, test } from "bun:test";
import { invoiceItemInputSchema } from "../src/schemas/invoice-item";

const valid = {
  amount: 14999,
  currency: "sar",
  description: "Annual subscription",
};

describe("invoiceItemInputSchema", () => {
  test("accepts a minimal valid item and uppercases currency", () => {
    const parsed = invoiceItemInputSchema.parse(valid);
    expect(parsed.currency).toBe("SAR");
    expect(parsed.amount).toBe(14999);
  });

  test("accepts full optional fields", () => {
    const parsed = invoiceItemInputSchema.parse({
      ...valid,
      expiredAt: "2026-08-01T00:00:00+03:00",
      callbackUrl: "https://internal.example.com/cb",
      successUrl: "https://internal.example.com/ok",
      backUrl: "https://internal.example.com/back",
      metadata: { order_ref: "PO-1234" },
    });
    expect(parsed.metadata).toEqual({ order_ref: "PO-1234" });
  });

  test("accepts date-only expiredAt (Moyasar allows ISO date)", () => {
    expect(() =>
      invoiceItemInputSchema.parse({ ...valid, expiredAt: "2026-08-01" }),
    ).not.toThrow();
  });

  test("rejects amount below Moyasar minimum of 100", () => {
    expect(() =>
      invoiceItemInputSchema.parse({ ...valid, amount: 99 }),
    ).toThrow();
  });

  test("rejects non-integer amounts", () => {
    expect(() =>
      invoiceItemInputSchema.parse({ ...valid, amount: 149.99 }),
    ).toThrow();
  });

  test("rejects blank description and bad currency", () => {
    expect(() =>
      invoiceItemInputSchema.parse({ ...valid, description: "  " }),
    ).toThrow();
    expect(() =>
      invoiceItemInputSchema.parse({ ...valid, currency: "SARR" }),
    ).toThrow();
  });

  test("rejects non-https-or-http urls and non-string metadata values", () => {
    expect(() =>
      invoiceItemInputSchema.parse({ ...valid, callbackUrl: "not-a-url" }),
    ).toThrow();
    expect(() =>
      invoiceItemInputSchema.parse({ ...valid, metadata: { a: 5 } }),
    ).toThrow();
  });
});
