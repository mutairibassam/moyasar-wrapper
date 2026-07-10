# Batches, Intake & Maker-Checker (Plan 3 of 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let makers assemble invoice batches from a CSV upload or an in-app grid, validate every row before anything is submittable, and drive each batch through a strict maker-checker lifecycle (draft → pending_approval → approved/rejected) with a complete audit trail — stopping just before actual Moyasar submission, which is Plan 4.

**Architecture:** Extend the existing `Repositories` bundle (`@moyasar-ops/db`) with `batches` and `items` repositories that join the same `transaction()` unit-of-work. Business logic lives in two `@moyasar-ops/api` services: `BatchesService` (create, list, get, edit-draft, CSV/grid intake, validation) and a maker-checker flow on the same service (submit-for-approval, approve, reject, clone-failed). Row validation reuses the shared `invoiceItemInputSchema` and `toMinorUnits`; CSV parsing is a pure function in `@moyasar-ops/shared` so the row shape is the single source of truth. Routes mount under `/api/v1/batches` behind the existing session/RBAC/CSRF middleware. No Moyasar calls in this plan.

**Tech Stack:** Bun ≥1.2, Hono 4, Drizzle ORM 0.45, Zod 4, PostgreSQL 17. No new runtime dependency (CSV is parsed with a hand-written parser; Excel is deferred).

**Plan roadmap:** Plan 3 of 6, stacked on `feature/auth` (Plan 2). Later: 4 Moyasar client + submission engine + job runner + webhooks/sync, 5 Next.js frontend, 6 E2E/deployment. This plan deliberately ends at `approved`; the `approved → submitting → submitted/partially_failed` transitions and the `submit_batch` job are Plan 4.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-06-moyasar-payment-ops-platform-design.md` (binding sections here: §6 batch lifecycle, §10 frontend/CSV format, §11 API surface, §9 audit, §12 errors).
- Workspace prefix `@moyasar-ops/`. TypeScript `strict: true`; no `any` in committed code (the one sanctioned cast is `db as unknown as { $client }` in integration-test `afterAll`).
- **Money is integer minor units** (halalas for SAR). CSV amounts arrive in **major units** (e.g. `149.99`) and are converted with `toMinorUnits(major, currency)` at the parse boundary. Moyasar minimum is **100 minor units**. Never floats.
- **Row identity within a batch** is `(batch_id, row_number)`, enforced by a DB `UNIQUE` constraint (added in Task 1).
- **Item statuses:** `draft | valid | invalid | submitting | submitted | failed`. This plan only produces `valid` / `invalid` (and `draft` transiently). `submitting`/`submitted`/`failed` are set by Plan 4.
- **Batch statuses:** `draft | pending_approval | rejected | approved | submitting | submitted | partially_failed`. This plan drives `draft → pending_approval → rejected → draft` and `pending_approval → approved`. It never sets `submitting`/`submitted`/`partially_failed`.
- **Maker-checker rules (spec §6), enforced in the service inside DB transactions:**
  1. Items are editable only while the batch is `draft` (a `rejected` batch is reopened to `draft` on the next edit — see Task 6).
  2. A batch may enter `pending_approval` only with ≥1 item and **zero `invalid` items**.
  3. `approve`/`reject` require role `approver` or `admin` **and** `approvedBy !== createdBy` — no self-approval, ever, including admins.
  4. Rejection requires a comment and returns the batch to `rejected` (editable); the maker resubmits.
  5. Approval snapshots totals + the active mode and is immutable thereafter (this plan stops at `approved`; no job is enqueued until Plan 4).
  6. Every transition writes an `audit_logs` row in the **same transaction** via `repos.audit.record(...)`.
- **RBAC (spec §8):** `maker` and `admin` create/edit/submit-for-approval; `approver` and `admin` approve/reject; `viewer` read-only. Route middleware guards roles; the service re-asserts the sensitive rules (no-self-approval, draft-only edits).
- **Errors:** throw the typed `AppError` subclasses (`ValidationError` 400, `AuthzError` 403, `NotFoundError` 404, `StateTransitionError` 409) from `apps/api/src/errors.ts`; the central mapper renders RFC 7807 `application/problem+json`. No new error-body construction sites.
- **Audit action names** used in this plan: `batch.created`, `batch.items_replaced`, `batch.submitted_for_approval`, `batch.approved`, `batch.rejected`, `batch.cloned_from_failed`.
- Tests use `bun:test`. Unit tests (services, parser, schemas) run with no DB via `bun run test:unit`; integration/API tests need Compose Postgres on host port **5433** with `DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops`, run under `bun run test:db`. Integration-test files must be named `*.integration.test.ts` so `test:unit` skips them.
- Commits: conventional style, one per task minimum, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Existing code this plan builds on (already implemented, do not recreate)

- `packages/db/src/schema/batches.ts` — `invoiceBatches`, `invoiceItems` tables + enums (`batchStatusEnum`, `itemStatusEnum`, `batchSourceEnum`, `modeEnum`, `moyasarInvoiceStatusEnum`).
- `packages/db/src/repositories/` — `types.ts` (`Repositories`, `Executor`, `AuditEntry`, row types), `index.ts` (`build(executor, root)` + `createRepositories(db)`), and the per-entity Drizzle repos. The bundle's `transaction()` reuses the executor when already inside a tx.
- `packages/shared/src/` — `invoiceItemInputSchema` / `InvoiceItemInput`, `toMinorUnits`, `formatMinorUnits`, enums (`ITEM_STATUSES`, `BATCH_STATUSES`, etc.).
- `apps/api/src/` — `errors.ts` (typed `AppError`s), `container.ts` (`Container = { config, repos, auth, users }`, `createContainer(db, config)`), `http-context.ts` (`AppEnv`, `clientIp`), `middleware/` (`sessionMiddleware`, `requireAuth`, `requireRole`, `csrfMiddleware`), `app.ts` (`createApp(container)`), `modules/auth/public-user.ts` (`PublicUser`).
- `apps/api/test/support/fake-repositories.ts` — in-memory `FakeRepositories` (users/sessions/audit). Task 4 extends it with batches/items.

---

### Task 1: Add the `(batch_id, row_number)` unique constraint

**Files:**
- Modify: `packages/db/src/schema/batches.ts` (add a unique constraint to `invoiceItems`)
- Create: `packages/db/migrations/0003_invoice_items_row_unique.sql` (generated)
- Test: `packages/db/test/invoice-items-unique.integration.test.ts`

**Interfaces:**
- Consumes: existing `invoiceItems` table.
- Produces: a unique constraint `invoice_items_batch_row_unique` on `(batch_id, row_number)`; the next migration index is `0003`.

- [ ] **Step 1: Add the unique constraint to the schema**

In `packages/db/src/schema/batches.ts`, add `unique` to the `drizzle-orm/pg-core` import (it currently imports `bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid`), then extend the `invoiceItems` table's second-argument array so it reads:

```ts
  (t) => [
    index("idx_items_batch").on(t.batchId),
    index("idx_items_moyasar_id").on(t.moyasarInvoiceId),
    index("idx_items_status").on(t.status),
    unique("invoice_items_batch_row_unique").on(t.batchId, t.rowNumber),
  ],
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/db
bun run generate --name=invoice_items_row_unique
cd ../..
```

Expected: `packages/db/migrations/0003_invoice_items_row_unique.sql` containing `ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_batch_row_unique" UNIQUE("batch_id","row_number");` and nothing destructive. Open it and confirm.

- [ ] **Step 3: Apply the migration (twice, for idempotency)**

```bash
docker compose up -d postgres
DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops bun run --cwd packages/db migrate
DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops bun run --cwd packages/db migrate
```

Expected: `migrations applied` both times (the second run applies nothing new).

- [ ] **Step 4: Write the failing integration test**

`packages/db/test/invoice-items-unique.integration.test.ts`:

```ts
import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, invoiceBatches, invoiceItems, users } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);

test("duplicate (batch_id, row_number) is rejected", async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `uniq-${Date.now()}@example.com`, passwordHash: "x", displayName: "U", role: "maker" })
    .returning();
  const [b] = await db
    .insert(invoiceBatches)
    .values({ name: "uniq batch", source: "manual", currency: "SAR", createdBy: u!.id })
    .returning();

  await db.insert(invoiceItems).values({
    batchId: b!.id, rowNumber: 1, amount: 100, currency: "SAR", description: "row 1",
  });

  let threw = false;
  try {
    await db.insert(invoiceItems).values({
      batchId: b!.id, rowNumber: 1, amount: 200, currency: "SAR", description: "dup row 1",
    });
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);

  // A different row_number in the same batch is fine.
  await db.insert(invoiceItems).values({
    batchId: b!.id, rowNumber: 2, amount: 200, currency: "SAR", description: "row 2",
  });

  await db.delete(invoiceItems).where(eq(invoiceItems.batchId, b!.id));
  await db.delete(invoiceBatches).where(eq(invoiceBatches.id, b!.id));
  await db.delete(users).where(eq(users.id, u!.id));
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
```

- [ ] **Step 5: Run the test**

Run: `DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops bun test packages/db`
Expected: all pass (existing + the new uniqueness test).

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): unique constraint on invoice_items (batch_id, row_number)"
```

---

### Task 2: CSV parsing in `@moyasar-ops/shared`

**Files:**
- Create: `packages/shared/src/csv/parse-invoices-csv.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/parse-invoices-csv.test.ts`

**Interfaces:**
- Consumes: `toMinorUnits`, `MoneyError` from `@moyasar-ops/shared`.
- Produces:
  - `type ParsedCsvRow = { rowNumber: number; raw: Record<string, string>; input?: InvoiceItemInput; errors: Record<string, string[]> }`.
  - `type CsvParseResult = { rows: ParsedCsvRow[]; fileErrors: string[] }`.
  - `function parseInvoicesCsv(text: string, opts: { currency: string }): CsvParseResult`.
- Task 5 (`BatchesService.ingestCsv`) consumes `parseInvoicesCsv`.

The header row is (spec §10): `amount,description,expired_at,success_url,back_url,callback_url` plus any number of `metadata.<key>` columns. `amount` is a **major-unit** decimal string; the parser converts it with `toMinorUnits`. `amount` and `description` are required; the rest are optional. Row numbers are 1-based over data rows (header is not a data row).

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/parse-invoices-csv.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/shared`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

`packages/shared/src/csv/parse-invoices-csv.ts`:

```ts
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
```

Add the money imports at the top:

```ts
import { MoneyError, toMinorUnits } from "../money";
```

Update `packages/shared/src/index.ts` to add:

```ts
export * from "./csv/parse-invoices-csv";
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test packages/shared && bun run typecheck`
Expected: PASS. Note: when the amount fails `toMinorUnits`, `candidate.amount` is absent, so `invoiceItemInputSchema.safeParse` also reports an amount issue — the code above records the `toMinorUnits` message first; the schema issues are merged, so `errors.amount` is non-empty either way. That satisfies the test.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): CSV invoice parser with per-row validation and metadata columns"
```

---

### Task 3: Batch request/response schemas in `@moyasar-ops/shared`

**Files:**
- Create: `packages/shared/src/schemas/batch.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/batch-schema.test.ts`

**Interfaces:**
- Consumes: `invoiceItemInputSchema` from `@moyasar-ops/shared`.
- Produces: `createBatchSchema`/`CreateBatchInput`, `replaceItemsSchema`/`ReplaceItemsInput`, `rejectBatchSchema`/`RejectBatchInput`, `listBatchesQuerySchema`/`ListBatchesQuery`. Consumed by the Task 7 routes and Plan 5's frontend.

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/batch-schema.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  createBatchSchema,
  listBatchesQuerySchema,
  rejectBatchSchema,
  replaceItemsSchema,
} from "../src/schemas/batch";

describe("createBatchSchema", () => {
  test("accepts a name + currency and uppercases the currency", () => {
    const v = createBatchSchema.parse({ name: "March payouts", currency: "sar" });
    expect(v.currency).toBe("SAR");
  });
  test("rejects a blank name and a bad currency", () => {
    expect(() => createBatchSchema.parse({ name: " ", currency: "SAR" })).toThrow();
    expect(() => createBatchSchema.parse({ name: "x", currency: "SARR" })).toThrow();
  });
});

describe("replaceItemsSchema", () => {
  test("accepts an array of item inputs", () => {
    const v = replaceItemsSchema.parse({
      items: [{ amount: 14999, currency: "SAR", description: "A" }],
    });
    expect(v.items).toHaveLength(1);
  });
  test("accepts an empty array (clearing the grid)", () => {
    expect(replaceItemsSchema.parse({ items: [] }).items).toEqual([]);
  });
  test("rejects more than 1000 items", () => {
    const items = Array.from({ length: 1001 }, () => ({ amount: 100, currency: "SAR", description: "x" }));
    expect(() => replaceItemsSchema.parse({ items })).toThrow();
  });
});

describe("rejectBatchSchema", () => {
  test("requires a non-empty comment", () => {
    expect(rejectBatchSchema.parse({ comment: "Fix amounts" }).comment).toBe("Fix amounts");
    expect(() => rejectBatchSchema.parse({ comment: "" })).toThrow();
  });
});

describe("listBatchesQuerySchema", () => {
  test("defaults page/perPage and accepts a status filter", () => {
    const v = listBatchesQuerySchema.parse({});
    expect(v.page).toBe(1);
    expect(v.perPage).toBe(25);
    expect(listBatchesQuerySchema.parse({ status: "draft" }).status).toBe("draft");
  });
  test("rejects an unknown status", () => {
    expect(() => listBatchesQuerySchema.parse({ status: "nope" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/shared`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/shared/src/schemas/batch.ts`:

```ts
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
```

Update `packages/shared/src/index.ts`:

```ts
export * from "./schemas/batch";
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test packages/shared && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): batch create/replace-items/reject/list schemas"
```

---

### Task 4: Batches & items repositories in the `Repositories` bundle

**Files:**
- Create: `packages/db/src/repositories/batches.repository.ts`
- Create: `packages/db/src/repositories/items.repository.ts`
- Modify: `packages/db/src/repositories/types.ts` (add row types + interfaces + bundle members)
- Modify: `packages/db/src/repositories/index.ts` (construct the new repos in `build`)
- Modify: `apps/api/test/support/fake-repositories.ts` (add in-memory batches/items)
- Test: `packages/db/test/batches-repository.integration.test.ts`

**Interfaces:**
- Consumes: `invoiceBatches`, `invoiceItems` tables; the existing `Executor`, `Repositories`, `build` machinery.
- Produces (added to `types.ts`):
  - `type BatchRow = typeof invoiceBatches.$inferSelect`, `NewBatchRow = typeof invoiceBatches.$inferInsert`, `ItemRow = typeof invoiceItems.$inferSelect`, `NewItemRow = typeof invoiceItems.$inferInsert`.
  - `type BatchListOptions = { page: number; perPage: number; status?: BatchRow["status"]; createdBy?: string }`.
  - `interface BatchesRepository { create(input: NewBatchRow): Promise<BatchRow>; findById(id: string): Promise<BatchRow | null>; list(opts: BatchListOptions): Promise<{ items: BatchRow[]; total: number }>; update(id: string, patch: Partial<NewBatchRow>): Promise<BatchRow | null> }`.
  - `interface ItemsRepository { listByBatch(batchId: string): Promise<ItemRow[]>; deleteByBatch(batchId: string): Promise<void>; insertMany(rows: NewItemRow[]): Promise<ItemRow[]>; countByBatch(batchId: string): Promise<{ total: number; invalid: number }> }`.
  - `Repositories` gains `batches: BatchesRepository` and `items: ItemsRepository`.
- Consumed by Tasks 5 & 6 (services) and Task 8 tests.

- [ ] **Step 1: Extend `types.ts`**

Add to the imports at the top of `packages/db/src/repositories/types.ts`:

```ts
import type { auditLogs, invoiceBatches, invoiceItems, sessions, users } from "../schema";
```

Add the row types after the existing ones:

```ts
export type BatchRow = typeof invoiceBatches.$inferSelect;
export type NewBatchRow = typeof invoiceBatches.$inferInsert;
export type ItemRow = typeof invoiceItems.$inferSelect;
export type NewItemRow = typeof invoiceItems.$inferInsert;

export type BatchListOptions = {
  page: number;
  perPage: number;
  status?: BatchRow["status"];
  createdBy?: string;
};

export interface BatchesRepository {
  create(input: NewBatchRow): Promise<BatchRow>;
  findById(id: string): Promise<BatchRow | null>;
  list(opts: BatchListOptions): Promise<{ items: BatchRow[]; total: number }>;
  update(id: string, patch: Partial<NewBatchRow>): Promise<BatchRow | null>;
}

export interface ItemsRepository {
  listByBatch(batchId: string): Promise<ItemRow[]>;
  deleteByBatch(batchId: string): Promise<void>;
  insertMany(rows: NewItemRow[]): Promise<ItemRow[]>;
  countByBatch(batchId: string): Promise<{ total: number; invalid: number }>;
}
```

Add the two members to the `Repositories` interface (keep the existing ones):

```ts
export interface Repositories {
  users: UsersRepository;
  sessions: SessionsRepository;
  audit: AuditRepository;
  batches: BatchesRepository;
  items: ItemsRepository;
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
```

- [ ] **Step 2: Implement the batches repository**

`packages/db/src/repositories/batches.repository.ts`:

```ts
import { and, count, desc, eq } from "drizzle-orm";
import { invoiceBatches } from "../schema";
import type {
  BatchesRepository,
  BatchListOptions,
  BatchRow,
  Executor,
  NewBatchRow,
} from "./types";

export class DrizzleBatchesRepository implements BatchesRepository {
  constructor(private readonly db: Executor) {}

  async create(input: NewBatchRow): Promise<BatchRow> {
    const [row] = await this.db.insert(invoiceBatches).values(input).returning();
    return row!;
  }

  async findById(id: string): Promise<BatchRow | null> {
    const [row] = await this.db
      .select()
      .from(invoiceBatches)
      .where(eq(invoiceBatches.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(opts: BatchListOptions): Promise<{ items: BatchRow[]; total: number }> {
    const filters = [
      opts.status ? eq(invoiceBatches.status, opts.status) : undefined,
      opts.createdBy ? eq(invoiceBatches.createdBy, opts.createdBy) : undefined,
    ].filter((f): f is NonNullable<typeof f> => f !== undefined);
    const where = filters.length > 0 ? and(...filters) : undefined;

    const items = await this.db
      .select()
      .from(invoiceBatches)
      .where(where)
      .orderBy(desc(invoiceBatches.createdAt))
      .limit(opts.perPage)
      .offset((opts.page - 1) * opts.perPage);

    const [row] = await this.db.select({ value: count() }).from(invoiceBatches).where(where);
    return { items, total: row?.value ?? 0 };
  }

  async update(id: string, patch: Partial<NewBatchRow>): Promise<BatchRow | null> {
    const [row] = await this.db
      .update(invoiceBatches)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(invoiceBatches.id, id))
      .returning();
    return row ?? null;
  }
}
```

- [ ] **Step 3: Implement the items repository**

`packages/db/src/repositories/items.repository.ts`:

```ts
import { and, count, eq } from "drizzle-orm";
import { invoiceItems } from "../schema";
import type { Executor, ItemRow, ItemsRepository, NewItemRow } from "./types";

export class DrizzleItemsRepository implements ItemsRepository {
  constructor(private readonly db: Executor) {}

  async listByBatch(batchId: string): Promise<ItemRow[]> {
    return this.db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.batchId, batchId))
      .orderBy(invoiceItems.rowNumber);
  }

  async deleteByBatch(batchId: string): Promise<void> {
    await this.db.delete(invoiceItems).where(eq(invoiceItems.batchId, batchId));
  }

  async insertMany(rows: NewItemRow[]): Promise<ItemRow[]> {
    if (rows.length === 0) return [];
    return this.db.insert(invoiceItems).values(rows).returning();
  }

  async countByBatch(batchId: string): Promise<{ total: number; invalid: number }> {
    const [totalRow] = await this.db
      .select({ value: count() })
      .from(invoiceItems)
      .where(eq(invoiceItems.batchId, batchId));
    const [invalidRow] = await this.db
      .select({ value: count() })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.batchId, batchId), eq(invoiceItems.status, "invalid")));
    return { total: totalRow?.value ?? 0, invalid: invalidRow?.value ?? 0 };
  }
}
```

- [ ] **Step 4: Wire them into `build`**

In `packages/db/src/repositories/index.ts`, import and construct the two new repos inside `build`:

```ts
import { DrizzleBatchesRepository } from "./batches.repository";
import { DrizzleItemsRepository } from "./items.repository";
```

and in the returned object (alongside `users`, `sessions`, `audit`):

```ts
    batches: new DrizzleBatchesRepository(executor),
    items: new DrizzleItemsRepository(executor),
```

- [ ] **Step 5: Extend `FakeRepositories`**

In `apps/api/test/support/fake-repositories.ts`, import the new types and add in-memory `batches`/`items`. Add to the imports:

```ts
import type {
  BatchesRepository,
  BatchListOptions,
  BatchRow,
  ItemRow,
  ItemsRepository,
  NewBatchRow,
  NewItemRow,
} from "@moyasar-ops/db";
```

Add backing arrays and the two repository properties to the class (place them beside the existing `users`/`sessions`/`audit`):

```ts
  batchRows: BatchRow[] = [];
  itemRows: ItemRow[] = [];

  batches: BatchesRepository = {
    create: async (input: NewBatchRow) => {
      const row: BatchRow = {
        id: input.id ?? uuidv7(),
        name: input.name,
        status: input.status ?? "draft",
        source: input.source,
        mode: input.mode ?? null,
        currency: input.currency,
        createdBy: input.createdBy,
        approvedBy: input.approvedBy ?? null,
        rejectionComment: input.rejectionComment ?? null,
        submittedForApprovalAt: input.submittedForApprovalAt ?? null,
        approvedAt: input.approvedAt ?? null,
        submittedAt: input.submittedAt ?? null,
        completedAt: input.completedAt ?? null,
        itemCount: input.itemCount ?? 0,
        totalAmount: input.totalAmount ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.batchRows.push(row);
      return row;
    },
    findById: async (id: string) => this.batchRows.find((b) => b.id === id) ?? null,
    list: async (opts: BatchListOptions) => {
      const filtered = this.batchRows
        .filter((b) => (opts.status ? b.status === opts.status : true))
        .filter((b) => (opts.createdBy ? b.createdBy === opts.createdBy : true));
      return { items: filtered, total: filtered.length };
    },
    update: async (id: string, patch: Partial<NewBatchRow>) => {
      const b = this.batchRows.find((x) => x.id === id);
      if (!b) return null;
      Object.assign(b, patch, { updatedAt: new Date() });
      return b;
    },
  };

  items: ItemsRepository = {
    listByBatch: async (batchId: string) =>
      this.itemRows.filter((i) => i.batchId === batchId).sort((a, b) => a.rowNumber - b.rowNumber),
    deleteByBatch: async (batchId: string) => {
      this.itemRows = this.itemRows.filter((i) => i.batchId !== batchId);
    },
    insertMany: async (rows: NewItemRow[]) => {
      const created = rows.map((input) => {
        const row: ItemRow = {
          id: input.id ?? uuidv7(),
          batchId: input.batchId,
          rowNumber: input.rowNumber,
          amount: input.amount,
          currency: input.currency,
          description: input.description,
          expiredAt: input.expiredAt ?? null,
          callbackUrl: input.callbackUrl ?? null,
          successUrl: input.successUrl ?? null,
          backUrl: input.backUrl ?? null,
          metadata: input.metadata ?? null,
          validationErrors: input.validationErrors ?? null,
          status: input.status ?? "draft",
          moyasarInvoiceId: input.moyasarInvoiceId ?? null,
          moyasarStatus: input.moyasarStatus ?? null,
          moyasarUrl: input.moyasarUrl ?? null,
          lastSyncedAt: input.lastSyncedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.itemRows.push(row);
        return row;
      });
      return created;
    },
    countByBatch: async (batchId: string) => {
      const inBatch = this.itemRows.filter((i) => i.batchId === batchId);
      return { total: inBatch.length, invalid: inBatch.filter((i) => i.status === "invalid").length };
    },
  };
```

- [ ] **Step 6: Write the failing integration test**

`packages/db/test/batches-repository.integration.test.ts`:

```ts
import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, createRepositories, invoiceBatches, invoiceItems, users } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const repos = createRepositories(db);

test("batches + items repositories create, list, count, and update", async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `br-${Date.now()}@example.com`, passwordHash: "x", displayName: "BR", role: "maker" })
    .returning();

  const batch = await repos.batches.create({
    name: "repo batch", source: "manual", currency: "SAR", createdBy: u!.id,
  });
  expect(batch.status).toBe("draft");

  await repos.items.insertMany([
    { batchId: batch.id, rowNumber: 1, amount: 14999, currency: "SAR", description: "A", status: "valid" },
    { batchId: batch.id, rowNumber: 2, amount: 100, currency: "SAR", description: "B", status: "invalid" },
  ]);

  const counts = await repos.items.countByBatch(batch.id);
  expect(counts.total).toBe(2);
  expect(counts.invalid).toBe(1);

  const listed = await repos.items.listByBatch(batch.id);
  expect(listed.map((i) => i.rowNumber)).toEqual([1, 2]);

  await repos.batches.update(batch.id, { status: "pending_approval" });
  const reread = await repos.batches.findById(batch.id);
  expect(reread?.status).toBe("pending_approval");

  const page = await repos.batches.list({ page: 1, perPage: 10, createdBy: u!.id });
  expect(page.items.some((b) => b.id === batch.id)).toBe(true);

  await db.delete(invoiceItems).where(eq(invoiceItems.batchId, batch.id));
  await db.delete(invoiceBatches).where(eq(invoiceBatches.id, batch.id));
  await db.delete(users).where(eq(users.id, u!.id));
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops bun test packages/db && bun run typecheck`
Expected: PASS. (The `FakeRepositories` change means `bun run test:unit` must still pass too — run it.)

Run: `bun run test:unit`
Expected: PASS (the extended fake still satisfies `Repositories`).

- [ ] **Step 8: Commit**

```bash
git add packages/db apps/api/test/support/fake-repositories.ts
git commit -m "feat(db): batches and items repositories in the transaction bundle"
```

---

### Task 5: BatchesService — create, list, get, and grid/CSV intake with validation

**Files:**
- Create: `apps/api/src/modules/batches/batch-view.ts`
- Create: `apps/api/src/modules/batches/batches.service.ts`
- Test: `apps/api/test/batches/batches.service.test.ts`

**Interfaces:**
- Consumes: `Repositories`, `NewItemRow`, `BatchRow`, `ItemRow` from `@moyasar-ops/db`; `CreateBatchInput`, `InvoiceItemInput`, `parseInvoicesCsv`, `formatMinorUnits` from `@moyasar-ops/shared`; `PublicUser` (`apps/api/src/modules/auth/public-user.ts`); `ValidationError`, `NotFoundError`, `AuthzError`, `StateTransitionError` from `apps/api/src/errors.ts`.
- Produces:
  - `type ItemView` and `type BatchView` + `toBatchView(batch, items)` in `batch-view.ts`.
  - `class BatchesService` with:
    - `create(actor: PublicUser, input: CreateBatchInput, ctx: { ip: string | null }): Promise<BatchView>`
    - `list(actor: PublicUser, opts: ListBatchesQuery): Promise<{ items: BatchSummary[]; meta: PageMeta }>`
    - `get(actor: PublicUser, id: string): Promise<BatchView>`
    - `replaceItems(actor: PublicUser, id: string, items: InvoiceItemInput[], ctx: { ip: string | null }): Promise<BatchView>`
    - `ingestCsv(actor: PublicUser, id: string, csvText: string, ctx: { ip: string | null }): Promise<BatchView>`
- Task 6 adds the maker-checker methods to the same class; Task 7 wires routes.

Validation rule shared by `replaceItems` and `ingestCsv`: each incoming row is re-validated with `invoiceItemInputSchema` (grid path) or already parsed (CSV path); a row that fails validation is stored with `status: "invalid"` and its `validationErrors`; a row that passes is stored `status: "valid"`. The batch's `itemCount` and `totalAmount` (sum of valid rows) are recomputed. Intake is allowed only when the batch is `draft` or `rejected` (editing a `rejected` batch is handled in Task 6; here both are treated as editable and `ingestCsv`/`replaceItems` set `source` accordingly). Everything happens in one `repos.transaction`.

- [ ] **Step 1: Implement the view mapper (no test file of its own; covered via the service)**

`apps/api/src/modules/batches/batch-view.ts`:

```ts
import type { BatchRow, ItemRow } from "@moyasar-ops/db";
import { formatMinorUnits } from "@moyasar-ops/shared";

export type ItemView = {
  id: string;
  rowNumber: number;
  amount: number;
  amountFormatted: string;
  currency: string;
  description: string;
  expiredAt: string | null;
  metadata: Record<string, string> | null;
  status: ItemRow["status"];
  validationErrors: Record<string, string[]> | null;
  moyasarInvoiceId: string | null;
  moyasarStatus: ItemRow["moyasarStatus"];
  moyasarUrl: string | null;
};

export type BatchView = {
  id: string;
  name: string;
  status: BatchRow["status"];
  source: BatchRow["source"];
  mode: BatchRow["mode"];
  currency: string;
  createdBy: string;
  approvedBy: string | null;
  rejectionComment: string | null;
  itemCount: number;
  totalAmount: number;
  totalAmountFormatted: string;
  createdAt: string;
  updatedAt: string;
  items: ItemView[];
};

export function toItemView(row: ItemRow): ItemView {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    amount: row.amount,
    amountFormatted: formatMinorUnits(row.amount, row.currency),
    currency: row.currency,
    description: row.description,
    expiredAt: row.expiredAt,
    metadata: row.metadata,
    status: row.status,
    validationErrors: row.validationErrors,
    moyasarInvoiceId: row.moyasarInvoiceId,
    moyasarStatus: row.moyasarStatus,
    moyasarUrl: row.moyasarUrl,
  };
}

export function toBatchView(batch: BatchRow, items: ItemRow[]): BatchView {
  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    source: batch.source,
    mode: batch.mode,
    currency: batch.currency,
    createdBy: batch.createdBy,
    approvedBy: batch.approvedBy,
    rejectionComment: batch.rejectionComment,
    itemCount: batch.itemCount,
    totalAmount: batch.totalAmount,
    totalAmountFormatted: formatMinorUnits(batch.totalAmount, batch.currency),
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    items: items.map(toItemView),
  };
}
```

- [ ] **Step 2: Write the failing service tests**

`apps/api/test/batches/batches.service.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { BatchesService } from "../../src/modules/batches/batches.service";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { FakeRepositories } from "../support/fake-repositories";

const maker: PublicUser = {
  id: "11111111-1111-7111-8111-111111111111",
  email: "maker@example.com",
  displayName: "Maker",
  role: "maker",
  isActive: true,
};
const ctx = { ip: "127.0.0.1" };

describe("BatchesService.create + intake", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("creates a draft batch and audits it", async () => {
    const view = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    expect(view.status).toBe("draft");
    expect(view.currency).toBe("SAR");
    expect(repos.auditRows.some((a) => a.action === "batch.created")).toBe(true);
  });

  test("replaceItems stores valid rows, recomputes totals, and audits", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    const view = await service.replaceItems(
      maker,
      b.id,
      [
        { amount: 14999, currency: "SAR", description: "A" },
        { amount: 100, currency: "SAR", description: "B" },
      ],
      ctx,
    );
    expect(view.itemCount).toBe(2);
    expect(view.totalAmount).toBe(15099);
    expect(view.items.every((i) => i.status === "valid")).toBe(true);
    expect(repos.auditRows.some((a) => a.action === "batch.items_replaced")).toBe(true);
  });

  test("replaceItems replaces (not appends) prior items and renumbers rows", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await service.replaceItems(maker, b.id, [{ amount: 100, currency: "SAR", description: "old" }], ctx);
    const view = await service.replaceItems(
      maker,
      b.id,
      [
        { amount: 200, currency: "SAR", description: "new1" },
        { amount: 300, currency: "SAR", description: "new2" },
      ],
      ctx,
    );
    expect(view.items.map((i) => i.rowNumber)).toEqual([1, 2]);
    expect(view.items.map((i) => i.description)).toEqual(["new1", "new2"]);
  });

  test("ingestCsv marks an invalid row and excludes it from the total", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    const csv = "amount,description,expired_at,success_url,back_url,callback_url\n149.99,Good,,,,\n0.99,TooSmall,,,,";
    const view = await service.ingestCsv(maker, b.id, csv, ctx);
    expect(view.itemCount).toBe(2);
    const invalid = view.items.find((i) => i.status === "invalid");
    expect(invalid?.validationErrors?.amount).toBeDefined();
    expect(view.totalAmount).toBe(14999); // only the valid row counts
  });

  test("ingestCsv rejects a file with a bad header (ValidationError)", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await expect(service.ingestCsv(maker, b.id, "nonsense\nrow", ctx)).rejects.toThrow(/column/i);
  });

  test("get returns the batch with items; unknown id throws NotFound", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    const got = await service.get(maker, b.id);
    expect(got.id).toBe(b.id);
    await expect(service.get(maker, "00000000-0000-7000-8000-000000000000")).rejects.toThrow();
  });

  test("a viewer cannot create a batch (AuthzError from the service guard)", async () => {
    const viewer: PublicUser = { ...maker, id: "v", role: "viewer" };
    await expect(service.create(viewer, { name: "x", currency: "SAR" }, ctx)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Implement the service**

`apps/api/src/modules/batches/batches.service.ts`:

```ts
import type { NewItemRow, Repositories } from "@moyasar-ops/db";
import {
  type CreateBatchInput,
  type InvoiceItemInput,
  type ListBatchesQuery,
  invoiceItemInputSchema,
  parseInvoicesCsv,
} from "@moyasar-ops/shared";
import { AuthzError, NotFoundError, StateTransitionError, ValidationError } from "../../errors";
import type { PublicUser } from "../auth/public-user";
import { type BatchView, toBatchView } from "./batch-view";

export type BatchSummary = {
  id: string;
  name: string;
  status: string;
  currency: string;
  itemCount: number;
  totalAmount: number;
  createdBy: string;
  createdAt: string;
};
export type PageMeta = { page: number; perPage: number; total: number; totalPages: number };

const EDITABLE_STATUSES = new Set(["draft", "rejected"]);

function canWrite(actor: PublicUser): boolean {
  return actor.role === "maker" || actor.role === "admin";
}

export class BatchesService {
  constructor(private readonly repos: Repositories) {}

  private async loadView(batchId: string): Promise<BatchView> {
    return this.loadViewTx(this.repos, batchId);
  }

  /** Build a BatchView from any executor (base repos or a transaction-scoped bundle). */
  private async loadViewTx(r: Repositories, batchId: string): Promise<BatchView> {
    const batch = await r.batches.findById(batchId);
    if (!batch) throw new NotFoundError("Batch not found");
    const items = await r.items.listByBatch(batchId);
    return toBatchView(batch, items);
  }

  async create(actor: PublicUser, input: CreateBatchInput, ctx: { ip: string | null }): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to create batches");
    return this.repos.transaction(async (r) => {
      const batch = await r.batches.create({
        name: input.name,
        currency: input.currency,
        source: "manual",
        createdBy: actor.id,
      });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.created",
        entityType: "batch",
        entityId: batch.id,
        after: { name: batch.name, currency: batch.currency },
        ip: ctx.ip,
      });
      return toBatchView(batch, []);
    });
  }

  async list(actor: PublicUser, opts: ListBatchesQuery): Promise<{ items: BatchSummary[]; meta: PageMeta }> {
    const { items, total } = await this.repos.batches.list({
      page: opts.page,
      perPage: opts.perPage,
      status: opts.status,
    });
    return {
      items: items.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        currency: b.currency,
        itemCount: b.itemCount,
        totalAmount: b.totalAmount,
        createdBy: b.createdBy,
        createdAt: b.createdAt.toISOString(),
      })),
      meta: {
        page: opts.page,
        perPage: opts.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
      },
    };
  }

  async get(_actor: PublicUser, id: string): Promise<BatchView> {
    return this.loadView(id);
  }

  /** Turn candidate inputs into item rows (valid rows counted into the total). */
  private stageRows(
    batchId: string,
    currency: string,
    candidates: { input?: InvoiceItemInput; errors: Record<string, string[]> }[],
  ): { rows: NewItemRow[]; total: number } {
    let total = 0;
    const rows = candidates.map((c, idx): NewItemRow => {
      const rowNumber = idx + 1;
      if (c.input && Object.keys(c.errors).length === 0) {
        total += c.input.amount;
        return {
          batchId,
          rowNumber,
          amount: c.input.amount,
          currency: c.input.currency,
          description: c.input.description,
          expiredAt: c.input.expiredAt ?? null,
          successUrl: c.input.successUrl ?? null,
          backUrl: c.input.backUrl ?? null,
          callbackUrl: c.input.callbackUrl ?? null,
          metadata: c.input.metadata ?? null,
          status: "valid",
          validationErrors: null,
        };
      }
      return {
        batchId,
        rowNumber,
        amount: c.input?.amount ?? 0,
        currency,
        description: c.input?.description ?? "",
        status: "invalid",
        validationErrors: c.errors,
      };
    });
    return { rows, total };
  }

  private async writeItems(
    actor: PublicUser,
    id: string,
    source: "manual" | "csv",
    candidates: { input?: InvoiceItemInput; errors: Record<string, string[]> }[],
    ctx: { ip: string | null },
  ): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to edit batches");
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (!EDITABLE_STATUSES.has(batch.status)) {
      throw new StateTransitionError(`Batch cannot be edited while it is ${batch.status}`);
    }

    const { rows, total } = this.stageRows(id, batch.currency, candidates);

    return this.repos.transaction(async (r) => {
      await r.items.deleteByBatch(id);
      await r.items.insertMany(rows);
      await r.batches.update(id, {
        source,
        status: "draft",
        itemCount: rows.length,
        totalAmount: total,
        rejectionComment: null,
      });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.items_replaced",
        entityType: "batch",
        entityId: id,
        after: { itemCount: rows.length, totalAmount: total, source },
        ip: ctx.ip,
      });
      return this.loadViewTx(r, id);
    });
  }

  async replaceItems(
    actor: PublicUser,
    id: string,
    items: InvoiceItemInput[],
    ctx: { ip: string | null },
  ): Promise<BatchView> {
    const candidates = items.map((item) => {
      const parsed = invoiceItemInputSchema.safeParse(item);
      if (parsed.success) return { input: parsed.data, errors: {} as Record<string, string[]> };
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_");
        (errors[key] ??= []).push(issue.message);
      }
      return { errors };
    });
    return this.writeItems(actor, id, "manual", candidates, ctx);
  }

  async ingestCsv(
    actor: PublicUser,
    id: string,
    csvText: string,
    ctx: { ip: string | null },
  ): Promise<BatchView> {
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    const result = parseInvoicesCsv(csvText, { currency: batch.currency });
    if (result.fileErrors.length > 0) {
      throw new ValidationError("The CSV file could not be read", { fileErrors: result.fileErrors });
    }
    const candidates = result.rows.map((row) => ({ input: row.input, errors: row.errors }));
    return this.writeItems(actor, id, "csv", candidates, ctx);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/api && bun run typecheck`
Expected: PASS. Note the `stageRows` renumbers rows 1..N in incoming order, guaranteeing `(batch_id, row_number)` uniqueness after the delete+insert.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): batches service with grid/CSV intake and per-row validation"
```

---

### Task 6: Maker-checker transitions on BatchesService

**Files:**
- Modify: `apps/api/src/modules/batches/batches.service.ts` (add transition methods)
- Test: `apps/api/test/batches/maker-checker.service.test.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces, added to `BatchesService`:
  - `submitForApproval(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView>`
  - `approve(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView>`
  - `reject(actor: PublicUser, id: string, comment: string, ctx: { ip: string | null }): Promise<BatchView>`
  - `cloneFailed(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView>` (clones `invalid` rows of a batch into a fresh draft so the maker can fix them; failed-submission cloning is extended in Plan 4)

- [ ] **Step 1: Write the failing tests**

`apps/api/test/batches/maker-checker.service.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { BatchesService } from "../../src/modules/batches/batches.service";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { FakeRepositories } from "../support/fake-repositories";

const maker: PublicUser = { id: "maker-1", email: "m@x.co", displayName: "M", role: "maker", isActive: true };
const approver: PublicUser = { id: "appr-1", email: "a@x.co", displayName: "A", role: "approver", isActive: true };
const ctx = { ip: "127.0.0.1" };

async function draftWithValidItems(service: BatchesService): Promise<string> {
  const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
  await service.replaceItems(maker, b.id, [{ amount: 14999, currency: "SAR", description: "A" }], ctx);
  return b.id;
}

describe("submitForApproval", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("moves a valid draft to pending_approval and audits", async () => {
    const id = await draftWithValidItems(service);
    const view = await service.submitForApproval(maker, id, ctx);
    expect(view.status).toBe("pending_approval");
    expect(repos.auditRows.some((a) => a.action === "batch.submitted_for_approval")).toBe(true);
  });

  test("refuses an empty batch", async () => {
    const b = await service.create(maker, { name: "Empty", currency: "SAR" }, ctx);
    await expect(service.submitForApproval(maker, b.id, ctx)).rejects.toThrow(/at least one/i);
  });

  test("refuses a batch containing invalid rows", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await service.replaceItems(
      maker,
      b.id,
      [{ amount: 14999, currency: "SAR", description: "ok" }, { amount: 1, currency: "SAR", description: "bad" }],
      ctx,
    );
    await expect(service.submitForApproval(maker, b.id, ctx)).rejects.toThrow(/invalid/i);
  });
});

describe("approve / reject (maker-checker)", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("an approver (not the creator) can approve a pending batch", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    const view = await service.approve(approver, id, ctx);
    expect(view.status).toBe("approved");
    expect(view.approvedBy).toBe(approver.id);
    expect(view.mode).not.toBeNull(); // mode snapshotted
    expect(repos.auditRows.some((a) => a.action === "batch.approved")).toBe(true);
  });

  test("the creator cannot approve their own batch, even as admin", async () => {
    const adminMaker: PublicUser = { ...maker, role: "admin" };
    const s = new BatchesService(repos);
    const b = await s.create(adminMaker, { name: "Self", currency: "SAR" }, ctx);
    await s.replaceItems(adminMaker, b.id, [{ amount: 100, currency: "SAR", description: "A" }], ctx);
    await s.submitForApproval(adminMaker, b.id, ctx);
    await expect(s.approve(adminMaker, b.id, ctx)).rejects.toThrow(/your own/i);
  });

  test("a maker cannot approve (role guard)", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    const otherMaker: PublicUser = { ...maker, id: "maker-2" };
    await expect(service.approve(otherMaker, id, ctx)).rejects.toThrow(/permission/i);
  });

  test("approve only works from pending_approval", async () => {
    const id = await draftWithValidItems(service);
    await expect(service.approve(approver, id, ctx)).rejects.toThrow(/pending/i);
  });

  test("reject requires a comment and returns the batch to rejected (editable)", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    const view = await service.reject(approver, id, "Wrong amounts", ctx);
    expect(view.status).toBe("rejected");
    expect(view.rejectionComment).toBe("Wrong amounts");
    expect(repos.auditRows.some((a) => a.action === "batch.rejected")).toBe(true);

    // A rejected batch is editable again.
    const edited = await service.replaceItems(maker, id, [{ amount: 500, currency: "SAR", description: "fixed" }], ctx);
    expect(edited.status).toBe("draft");
    expect(edited.rejectionComment).toBeNull();
  });

  test("an approved batch is immutable (cannot be edited)", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    await service.approve(approver, id, ctx);
    await expect(
      service.replaceItems(maker, id, [{ amount: 100, currency: "SAR", description: "x" }], ctx),
    ).rejects.toThrow(/cannot be edited/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/api/test/batches/maker-checker.service.test.ts`
Expected: FAIL — methods not defined.

- [ ] **Step 3: Add the transition methods to `BatchesService`**

Append these methods inside the `BatchesService` class in `apps/api/src/modules/batches/batches.service.ts`:

```ts
  async submitForApproval(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to submit batches");
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (!EDITABLE_STATUSES.has(batch.status)) {
      throw new StateTransitionError(`Only a draft or rejected batch can be submitted (it is ${batch.status})`);
    }
    const counts = await this.repos.items.countByBatch(id);
    if (counts.total === 0) throw new ValidationError("A batch needs at least one item before submission");
    if (counts.invalid > 0) {
      throw new ValidationError(`The batch has ${counts.invalid} invalid row(s); fix them before submitting`);
    }

    return this.repos.transaction(async (r) => {
      await r.batches.update(id, {
        status: "pending_approval",
        submittedForApprovalAt: new Date(),
        rejectionComment: null,
      });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.submitted_for_approval",
        entityType: "batch",
        entityId: id,
        ip: ctx.ip,
      });
      return this.loadViewTx(r, id);
    });
  }

  async approve(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (actor.role !== "approver" && actor.role !== "admin") {
      throw new AuthzError("You do not have permission to approve batches");
    }
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.status !== "pending_approval") {
      throw new StateTransitionError(`Only a pending_approval batch can be approved (it is ${batch.status})`);
    }
    if (batch.createdBy === actor.id) {
      throw new AuthzError("You cannot approve your own batch");
    }

    return this.repos.transaction(async (r) => {
      const before = { status: batch.status };
      await r.batches.update(id, {
        status: "approved",
        approvedBy: actor.id,
        approvedAt: new Date(),
        mode: "test", // active mode is snapshotted here; Plan 4 reads it from settings
      });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.approved",
        entityType: "batch",
        entityId: id,
        before,
        after: { status: "approved", approvedBy: actor.id },
        ip: ctx.ip,
      });
      return this.loadViewTx(r, id);
    });
  }

  async reject(actor: PublicUser, id: string, comment: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (actor.role !== "approver" && actor.role !== "admin") {
      throw new AuthzError("You do not have permission to reject batches");
    }
    if (comment.trim() === "") throw new ValidationError("A rejection comment is required");
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.status !== "pending_approval") {
      throw new StateTransitionError(`Only a pending_approval batch can be rejected (it is ${batch.status})`);
    }
    if (batch.createdBy === actor.id) {
      throw new AuthzError("You cannot reject your own batch");
    }

    return this.repos.transaction(async (r) => {
      await r.batches.update(id, { status: "rejected", rejectionComment: comment });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.rejected",
        entityType: "batch",
        entityId: id,
        after: { status: "rejected", comment },
        ip: ctx.ip,
      });
      return this.loadViewTx(r, id);
    });
  }

  async cloneFailed(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to clone batches");
    const source = await this.repos.batches.findById(id);
    if (!source) throw new NotFoundError("Batch not found");
    const items = await this.repos.items.listByBatch(id);
    const failed = items.filter((i) => i.status === "invalid" || i.status === "failed");
    if (failed.length === 0) {
      throw new ValidationError("This batch has no invalid or failed rows to clone");
    }

    return this.repos.transaction(async (r) => {
      const clone = await r.batches.create({
        name: `${source.name} (retry)`,
        currency: source.currency,
        source: source.source,
        createdBy: actor.id,
      });
      const rows = failed.map((item, idx) => ({
        batchId: clone.id,
        rowNumber: idx + 1,
        amount: item.amount,
        currency: item.currency,
        description: item.description,
        expiredAt: item.expiredAt,
        successUrl: item.successUrl,
        backUrl: item.backUrl,
        callbackUrl: item.callbackUrl,
        metadata: item.metadata,
        status: "draft" as const,
        validationErrors: null,
      }));
      await r.items.insertMany(rows);
      await r.batches.update(clone.id, { itemCount: rows.length });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.cloned_from_failed",
        entityType: "batch",
        entityId: clone.id,
        after: { clonedFrom: id, rows: rows.length },
        ip: ctx.ip,
      });
      return this.loadViewTx(r, clone.id);
    });
  }
```

These methods reuse the `loadViewTx(r, batchId)` private helper already defined on `BatchesService` in Task 5 — do not redefine it.

> Note: cloned rows are inserted with `status: "draft"`; the maker then re-runs `replaceItems`/`ingestCsv` (or the grid) which re-validates and flips them to `valid`/`invalid`. `itemCount` on the clone is set, but `totalAmount` stays 0 until the rows are re-validated — that's fine because a `draft` clone can't be submitted until it goes through intake, which recomputes the total.

- [ ] **Step 4: Run to verify pass**

Run: `bun test apps/api && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): maker-checker transitions (submit/approve/reject/clone) with audit"
```

---

### Task 7: Batch routes + mount in the app

**Files:**
- Create: `apps/api/src/modules/batches/batches.routes.ts`
- Modify: `apps/api/src/container.ts` (add `batches` service)
- Modify: `apps/api/src/app.ts` (mount `/api/v1/batches`)
- Test: `apps/api/test/api/batches-flow.integration.test.ts`

**Interfaces:**
- Consumes: `BatchesService` (Tasks 5-6); `createBatchSchema`, `replaceItemsSchema`, `rejectBatchSchema`, `listBatchesQuerySchema` from `@moyasar-ops/shared`; `requireAuth`, `requireRole`; `AppEnv`, `clientIp`; `ValidationError`.
- Produces: `batchesRoutes()` mounted at `/api/v1/batches`; `Container` gains `batches: BatchesService`. The route surface (spec §11):
  - `GET /batches` (any authenticated role), `POST /batches` (maker/admin), `GET /batches/:id`, `PATCH /batches/:id/items` (replace grid; maker/admin), `POST /batches/:id/csv` (multipart; maker/admin), `POST /batches/:id/submit-for-approval` (maker/admin), `POST /batches/:id/approve` (approver/admin), `POST /batches/:id/reject` (approver/admin), `POST /batches/:id/clone-failed` (maker/admin).

- [ ] **Step 1: Add the service to the container**

In `apps/api/src/container.ts`, import and construct `BatchesService`:

```ts
import { BatchesService } from "./modules/batches/batches.service";
```

Add `batches` to the `Container` type and `createContainer`:

```ts
export type Container = {
  config: Config;
  repos: Repositories;
  auth: AuthService;
  users: UsersService;
  batches: BatchesService;
};
```

and in the returned object:

```ts
  const batches = new BatchesService(repos);
  return { config, repos, auth, users, batches };
```

- [ ] **Step 2: Implement the routes**

`apps/api/src/modules/batches/batches.routes.ts`:

```ts
import { Hono } from "hono";
import {
  createBatchSchema,
  listBatchesQuerySchema,
  rejectBatchSchema,
  replaceItemsSchema,
} from "@moyasar-ops/shared";
import { ValidationError } from "../../errors";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { requireAuth, requireRole } from "../../middleware/rbac";

export function batchesRoutes() {
  const app = new Hono<AppEnv>();
  const ipOf = (c: { req: { header(name: string): string | undefined } }) =>
    clientIp(c.req.header("x-forwarded-for"));

  // All batch routes require authentication.
  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const parsed = listBatchesQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) throw new ValidationError("Invalid query", parsed.error.flatten());
    const result = await c.get("container").batches.list(c.get("user")!, parsed.data);
    return c.json(result);
  });

  app.post("/", requireRole("maker", "admin"), async (c) => {
    const parsed = createBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid batch payload", parsed.error.flatten());
    const view = await c.get("container").batches.create(c.get("user")!, parsed.data, { ip: ipOf(c) });
    return c.json({ batch: view }, 201);
  });

  app.get("/:id", async (c) => {
    const view = await c.get("container").batches.get(c.get("user")!, c.req.param("id"));
    return c.json({ batch: view });
  });

  app.patch("/:id/items", requireRole("maker", "admin"), async (c) => {
    const parsed = replaceItemsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid items payload", parsed.error.flatten());
    const view = await c
      .get("container")
      .batches.replaceItems(c.get("user")!, c.req.param("id"), parsed.data.items, { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/csv", requireRole("maker", "admin"), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new ValidationError("Expected a multipart file field named 'file'");
    const text = await file.text();
    const view = await c
      .get("container")
      .batches.ingestCsv(c.get("user")!, c.req.param("id"), text, { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/submit-for-approval", requireRole("maker", "admin"), async (c) => {
    const view = await c
      .get("container")
      .batches.submitForApproval(c.get("user")!, c.req.param("id"), { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/approve", requireRole("approver", "admin"), async (c) => {
    const view = await c
      .get("container")
      .batches.approve(c.get("user")!, c.req.param("id"), { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/reject", requireRole("approver", "admin"), async (c) => {
    const parsed = rejectBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("A rejection comment is required", parsed.error.flatten());
    const view = await c
      .get("container")
      .batches.reject(c.get("user")!, c.req.param("id"), parsed.data.comment, { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/clone-failed", requireRole("maker", "admin"), async (c) => {
    const view = await c
      .get("container")
      .batches.cloneFailed(c.get("user")!, c.req.param("id"), { ip: ipOf(c) });
    return c.json({ batch: view }, 201);
  });

  return app;
}
```

- [ ] **Step 3: Mount in `app.ts`**

In `apps/api/src/app.ts`, import and mount the batch routes alongside the existing ones:

```ts
import { batchesRoutes } from "./modules/batches/batches.routes";
```

and after the `usersRoutes()`/`auditRoutes()` mounts:

```ts
  app.route("/api/v1/batches", batchesRoutes());
```

The existing CSRF wrapper (`app.use("/api/v1/*", ...)`) already covers these mutating routes; no change needed there. The `POST /batches/:id/csv` route is multipart but still requires the CSRF header (it is not the login route).

- [ ] **Step 4: Write the failing API integration test**

`apps/api/test/api/batches-flow.integration.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createDb, createRepositories, invoiceBatches, invoiceItems, sessions, users, auditLogs } from "@moyasar-ops/db";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { createContainer } from "../../src/container";
import { hashPassword } from "../../src/modules/auth/password";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const config = { ...loadConfig({ DATABASE_URL: url } as NodeJS.ProcessEnv), cookieSecure: false };
const app = createApp(createContainer(db, config));

const stamp = Date.now();
const makerEmail = `bf-maker-${stamp}@example.com`;
const approverEmail = `bf-approver-${stamp}@example.com`;
const ids: string[] = [];

async function seed(email: string, role: "maker" | "approver") {
  const repos = createRepositories(db);
  const u = await repos.users.create({ email, passwordHash: await hashPassword("a-strong-password"), displayName: role, role });
  ids.push(u.id);
  return u.id;
}
function jar(setCookies: string[]) {
  const parts = setCookies.map((c) => c.split(";")[0]!);
  const csrf = parts.find((c) => c.startsWith("csrf_token="))!.split("=")[1]!;
  return { cookie: parts.join("; "), csrf };
}
async function login(email: string) {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "a-strong-password" }),
  });
  return jar(res.headers.getSetCookie());
}

beforeAll(async () => {
  await seed(makerEmail, "maker");
  await seed(approverEmail, "approver");
});

test("maker creates+fills a batch, submits; approver approves; self-approval is blocked", async () => {
  const maker = await login(makerEmail);
  const approver = await login(approverEmail);

  // Create
  const created = await app.request("/api/v1/batches", {
    method: "POST",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ name: "Integration batch", currency: "SAR" }),
  });
  expect(created.status).toBe(201);
  const batchId = (await created.json()).batch.id as string;

  // Fill via grid
  const filled = await app.request(`/api/v1/batches/${batchId}/items`, {
    method: "PATCH",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ items: [{ amount: 14999, currency: "SAR", description: "Seat" }] }),
  });
  expect(filled.status).toBe(200);
  expect((await filled.json()).batch.totalAmount).toBe(14999);

  // Submit for approval
  const submitted = await app.request(`/api/v1/batches/${batchId}/submit-for-approval`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
  });
  expect(submitted.status).toBe(200);
  expect((await submitted.json()).batch.status).toBe("pending_approval");

  // Maker cannot approve (role guard => 403)
  const selfApprove = await app.request(`/api/v1/batches/${batchId}/approve`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
  });
  expect(selfApprove.status).toBe(403);

  // Approver approves
  const approved = await app.request(`/api/v1/batches/${batchId}/approve`, {
    method: "POST",
    headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf },
  });
  expect(approved.status).toBe(200);
  expect((await approved.json()).batch.status).toBe("approved");

  // Approved batch is immutable
  const editAfter = await app.request(`/api/v1/batches/${batchId}/items`, {
    method: "PATCH",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ items: [{ amount: 100, currency: "SAR", description: "x" }] }),
  });
  expect(editAfter.status).toBe(409);
});

test("CSV upload validates rows and blocks submission until fixed", async () => {
  const maker = await login(makerEmail);
  const created = await app.request("/api/v1/batches", {
    method: "POST",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ name: "CSV batch", currency: "SAR" }),
  });
  const batchId = (await created.json()).batch.id as string;

  const csv = "amount,description,expired_at,success_url,back_url,callback_url\n149.99,Good,,,,\n0.50,Bad,,,,";
  const form = new FormData();
  form.append("file", new File([csv], "invoices.csv", { type: "text/csv" }));
  const uploaded = await app.request(`/api/v1/batches/${batchId}/csv`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
    body: form,
  });
  expect(uploaded.status).toBe(200);
  const view = (await uploaded.json()).batch;
  expect(view.items.filter((i: { status: string }) => i.status === "invalid")).toHaveLength(1);

  // Submission blocked while an invalid row remains
  const blocked = await app.request(`/api/v1/batches/${batchId}/submit-for-approval`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
  });
  expect(blocked.status).toBe(400);
});

afterAll(async () => {
  const bIds = (await db.select({ id: invoiceBatches.id }).from(invoiceBatches).where(inArray(invoiceBatches.createdBy, ids))).map((r) => r.id);
  if (bIds.length > 0) {
    await db.delete(invoiceItems).where(inArray(invoiceItems.batchId, bIds));
    await db.delete(invoiceBatches).where(inArray(invoiceBatches.id, bIds));
  }
  for (const id of ids) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    // audit_logs is append-only (trigger) — cannot delete; harmless test rows remain.
  }
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
```

- [ ] **Step 5: Run the full suite + typecheck**

Run: `bun run typecheck` then `DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops bun test`
Expected: all pass. Note: `app.test.ts` and the existing auth integration test must still pass (the container now has a `batches` field — constructing it is unchanged for callers).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): batch routes (create/fill/csv/submit/approve/reject/clone) mounted"
```

---

## Verification (whole plan)

- [ ] `bun run typecheck` — clean across all three workspaces
- [ ] `bun run test:unit` — passes with NO database (shared parser/schema tests + service tests via FakeRepositories)
- [ ] `docker compose up -d postgres` then `DATABASE_URL=…5433… bun test` — all integration + API tests pass
- [ ] Manual: log in as a maker, `POST /batches`, upload a CSV with one good + one bad row, confirm the bad row is `invalid` and submission is refused; fix it; submit; log in as an approver and approve; confirm self-approval by the maker is 403 and editing an approved batch is 409
- [ ] `git log --oneline` shows one commit per task (7 commits)

## Notes carried forward to Plan 4

- Plan 4 owns the `approved → submitting → submitted/partially_failed` transitions and the `submit_batch` job; `approve()` currently snapshots `mode: "test"` as a placeholder — Plan 4 must read the active mode from `app_settings` at approval time (or at submission) and set it here instead of the hard-coded `"test"`.
- Every invoice created at Moyasar must carry `metadata: { platform_item_id, platform_batch_id }` (spec §5/§7.3); the item and batch UUIDs are those values — no schema change needed.
- `cloneFailed` currently clones `invalid`/`failed` rows as `draft`; once Plan 4 introduces `failed` items from real submission, the same method covers the "clone failed submissions into a new batch" flow from spec §7.2.
- `totalAmount` is the sum of `valid` rows only; keep that invariant when Plan 4 adds submission bookkeeping.
