import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const webhookEventStatusEnum = pgEnum("webhook_event_status", [
  "received",
  "processed",
  "failed",
  "ignored",
]);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    eventType: text("event_type").notNull(),
    moyasarPaymentId: text("moyasar_payment_id"),
    moyasarInvoiceId: text("moyasar_invoice_id"),
    payload: jsonb("payload").notNull(),
    status: webhookEventStatusEnum("status").notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("idx_webhook_payment").on(t.moyasarPaymentId)],
);
