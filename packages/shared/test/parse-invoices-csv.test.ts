import { describe, expect, test } from "bun:test";
import { parseInvoicesCsv } from "../src/csv/parse-invoices-csv";

const header = "amount,description,expired_at,success_url,back_url,callback_url";

describe("parseInvoicesCsv", () => {
  test("parses a valid row and converts the amount to minor units", () => {
    const res = parseInvoicesCsv(`${header}\n149.99,Annual subscription,,,,`, { currency: "SAR" });
    expect(res.fileErrors).toEqual([]);
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0]!;
    expect(row.rowNumber).toBe(1);
    expect(row.errors).toEqual({});
    expect(row.input?.amount).toBe(14999);
    expect(row.input?.currency).toBe("SAR");
    expect(row.input?.description).toBe("Annual subscription");
  });

  test("collects metadata.* columns into a metadata object", () => {
    const res = parseInvoicesCsv(
      `${header},metadata.order_ref,metadata.dept\n10.00,Widget,,,,,PO-1,Finance`,
      { currency: "SAR" },
    );
    expect(res.rows[0]!.input?.metadata).toEqual({ order_ref: "PO-1", dept: "Finance" });
  });

  test("reports a per-field error for a bad amount and still records the row", () => {
    const res = parseInvoicesCsv(`${header}\nabc,Widget,,,,`, { currency: "SAR" });
    expect(res.rows[0]!.input).toBeUndefined();
    expect(res.rows[0]!.errors.amount).toBeDefined();
  });

  test("rejects an amount below the Moyasar minimum of 100 minor units", () => {
    const res = parseInvoicesCsv(`${header}\n0.99,Widget,,,,`, { currency: "SAR" });
    expect(res.rows[0]!.errors.amount).toBeDefined();
  });

  test("flags a missing required description", () => {
    const res = parseInvoicesCsv(`${header}\n10.00,,,,, `, { currency: "SAR" });
    expect(res.rows[0]!.errors.description).toBeDefined();
  });

  test("handles quoted fields containing commas", () => {
    const res = parseInvoicesCsv(`${header}\n10.00,"Widgets, deluxe",,,,`, { currency: "SAR" });
    expect(res.rows[0]!.input?.description).toBe("Widgets, deluxe");
  });

  test("tolerates a UTF-8 BOM and CRLF line endings", () => {
    const res = parseInvoicesCsv(`﻿${header}\r\n10.00,Widget,,,,\r\n`, { currency: "SAR" });
    expect(res.fileErrors).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.input?.amount).toBe(1000);
  });

  test("reports a file error for a missing required header column", () => {
    const res = parseInvoicesCsv(`description\nWidget`, { currency: "SAR" });
    expect(res.fileErrors.length).toBeGreaterThan(0);
    expect(res.rows).toHaveLength(0);
  });

  test("reports a file error for an empty file", () => {
    const res = parseInvoicesCsv("", { currency: "SAR" });
    expect(res.fileErrors.length).toBeGreaterThan(0);
  });

  test("skips fully-blank lines without creating rows", () => {
    const res = parseInvoicesCsv(`${header}\n10.00,Widget,,,,\n\n5.00,,,,,`, { currency: "SAR" });
    expect(res.rows).toHaveLength(2);
    expect(res.rows[1]!.rowNumber).toBe(2);
  });
});
