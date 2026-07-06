import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const jobTypeEnum = pgEnum("job_type", ["submit_batch", "sync_invoices"]);

export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "done", "failed"]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    type: jobTypeEnum("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: jobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_jobs_claim").on(t.status, t.runAt)],
);
