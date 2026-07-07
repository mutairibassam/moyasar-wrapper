import { MoneyError, toMinorUnits } from "../money";
import { invoiceItemInputSchema, type InvoiceItemInput } from "../schemas/invoice-item";

export type ParsedCsvRow = {
  rowNumber: number;
  raw: Record<string, string>;
  input?: InvoiceItemInput;
  errors: Record<string, string[]>;
};

export type CsvParseResult = { rows: ParsedCsvRow[]; fileErrors: string[] };

const REQUIRED_HEADERS = ["amount", "description"] as const;
const KNOWN_HEADERS = [
  "amount",
  "description",
  "expired_at",
  "success_url",
  "back_url",
  "callback_url",
] as const;

/** Split one CSV line into fields, honoring double-quoted fields with embedded commas and "" escapes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

export function parseInvoicesCsv(text: string, opts: { currency: string }): CsvParseResult {
  const fileErrors: string[] = [];
  const stripped = text.replace(/^﻿/, "");
  const lines = stripped.split(/\r\n|\r|\n/);

  const headerLine = lines.find((l) => l.trim() !== "");
  if (headerLine === undefined) {
    return { rows: [], fileErrors: ["The file is empty."] };
  }
  const headerIndex = lines.indexOf(headerLine);
  const headers = splitCsvLine(headerLine).map((h) => h.trim());

  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) {
      fileErrors.push(`Missing required column "${required}".`);
    }
  }
  if (fileErrors.length > 0) {
    return { rows: [], fileErrors };
  }

  const rows: ParsedCsvRow[] = [];
  let rowNumber = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    rowNumber++;

    const cells = splitCsvLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = (cells[idx] ?? "").trim();
    });

    const errors: Record<string, string[]> = {};

    const metadata: Record<string, string> = {};
    for (const h of headers) {
      if (h.startsWith("metadata.")) {
        const key = h.slice("metadata.".length);
        const value = raw[h] ?? "";
        if (key !== "" && value !== "") metadata[key] = value;
      } else if (!(KNOWN_HEADERS as readonly string[]).includes(h) && h !== "") {
        // Unknown non-metadata columns are ignored (not an error).
      }
    }

    const candidate: Record<string, unknown> = {
      currency: opts.currency,
      description: raw.description ?? "",
    };

    const amountRaw = raw.amount ?? "";
    try {
      candidate.amount = toMinorUnits(amountRaw, opts.currency);
    } catch (e) {
      errors.amount = [e instanceof MoneyError ? e.message : `Invalid amount "${amountRaw}"`];
    }

    if (raw.expired_at) candidate.expiredAt = raw.expired_at;
    if (raw.success_url) candidate.successUrl = raw.success_url;
    if (raw.back_url) candidate.backUrl = raw.back_url;
    if (raw.callback_url) candidate.callbackUrl = raw.callback_url;
    if (Object.keys(metadata).length > 0) candidate.metadata = metadata;

    const parsed = invoiceItemInputSchema.safeParse(candidate);
    if (parsed.success) {
      rows.push({ rowNumber, raw, input: parsed.data, errors });
    } else {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_");
        (errors[key] ??= []).push(issue.message);
      }
      rows.push({ rowNumber, raw, errors });
    }
  }

  return { rows, fileErrors };
}
