export const USER_ROLES = ["admin", "maker", "approver", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const BATCH_STATUSES = [
  "draft",
  "pending_approval",
  "rejected",
  "approved",
  "submitting",
  "submitted",
  "partially_failed",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const ITEM_STATUSES = [
  "draft",
  "valid",
  "invalid",
  "submitting",
  "submitted",
  "failed",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const MOYASAR_INVOICE_STATUSES = [
  "initiated",
  "paid",
  "failed",
  "refunded",
  "canceled",
  "on_hold",
  "expired",
  "voided",
] as const;
export type MoyasarInvoiceStatus = (typeof MOYASAR_INVOICE_STATUSES)[number];

export const BATCH_SOURCES = ["csv", "manual"] as const;
export type BatchSource = (typeof BATCH_SOURCES)[number];

export const MODES = ["test", "live"] as const;
export type Mode = (typeof MODES)[number];

export const JOB_TYPES = ["submit_batch", "sync_invoices"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["pending", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = [
  "received",
  "processed",
  "failed",
  "ignored",
] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];
