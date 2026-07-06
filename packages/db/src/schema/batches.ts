import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";
import { users } from "./users";

export const batchStatusEnum = pgEnum("batch_status", [
  "draft",
  "pending_approval",
  "rejected",
  "approved",
  "submitting",
  "submitted",
  "partially_failed",
]);

export const batchSourceEnum = pgEnum("batch_source", ["csv", "manual"]);

export const modeEnum = pgEnum("mode", ["test", "live"]);

export const itemStatusEnum = pgEnum("item_status", [
  "draft",
  "valid",
  "invalid",
  "submitting",
  "submitted",
  "failed",
]);

export const moyasarInvoiceStatusEnum = pgEnum("moyasar_invoice_status", [
  "initiated",
  "paid",
  "failed",
  "refunded",
  "canceled",
  "on_hold",
  "expired",
  "voided",
]);

export const invoiceBatches = pgTable(
  "invoice_batches",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    name: text("name").notNull(),
    status: batchStatusEnum("status").notNull().default("draft"),
    source: batchSourceEnum("source").notNull(),
    mode: modeEnum("mode"),
    currency: text("currency").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    rejectionComment: text("rejection_comment"),
    submittedForApprovalAt: timestamp("submitted_for_approval_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    itemCount: integer("item_count").notNull().default(0),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_batches_status").on(t.status), index("idx_batches_created_by").on(t.createdBy)],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    batchId: uuid("batch_id").notNull().references(() => invoiceBatches.id),
    rowNumber: integer("row_number").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),
    expiredAt: text("expired_at"),
    callbackUrl: text("callback_url"),
    successUrl: text("success_url"),
    backUrl: text("back_url"),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    validationErrors: jsonb("validation_errors").$type<Record<string, string[]>>(),
    status: itemStatusEnum("status").notNull().default("draft"),
    moyasarInvoiceId: text("moyasar_invoice_id"),
    moyasarStatus: moyasarInvoiceStatusEnum("moyasar_status"),
    moyasarUrl: text("moyasar_url"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_items_batch").on(t.batchId),
    index("idx_items_moyasar_id").on(t.moyasarInvoiceId),
    index("idx_items_status").on(t.status),
  ],
);
