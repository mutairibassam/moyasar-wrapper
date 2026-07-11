import type { appSettings, auditLogs, invoiceBatches, invoiceItems, jobs, sessions, userRoleEnum, users } from "../schema";
import type { Db } from "../client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type UpsertByEntraOidInput = {
  entraOid: string;
  email: string;
  displayName: string;
  groupsSnapshot: string[];
  defaultRole: UserRole;
};
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type AuditRow = typeof auditLogs.$inferSelect;
export type BatchRow = typeof invoiceBatches.$inferSelect;
export type NewBatchRow = typeof invoiceBatches.$inferInsert;
export type ItemRow = typeof invoiceItems.$inferSelect;
export type NewItemRow = typeof invoiceItems.$inferInsert;
export type SettingsRow = typeof appSettings.$inferSelect;
export type NewSettingsRow = typeof appSettings.$inferInsert;
export type JobRow = typeof jobs.$inferSelect;

export type BatchListOptions = {
  page: number;
  perPage: number;
  status?: BatchRow["status"];
  createdBy?: string;
};

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

export type AuditListOptions = {
  page: number;
  perPage: number;
  actorId?: string;
  action?: string;
  entityType?: string;
};

export interface UsersRepository {
  findById(id: string): Promise<UserRow | null>;
  findByEmail(email: string): Promise<UserRow | null>;
  findByEntraOid(entraOid: string): Promise<UserRow | null>;
  list(): Promise<UserRow[]>;
  create(input: NewUserRow): Promise<UserRow>;
  update(id: string, patch: Partial<NewUserRow>): Promise<UserRow | null>;
  upsertByEntraOid(input: UpsertByEntraOidInput): Promise<UserRow>;
}

export interface SessionsRepository {
  create(input: NewSessionRow): Promise<SessionRow>;
  findByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
  updateExpiry(id: string, expiresAt: Date): Promise<void>;
}

export interface AuditRepository {
  record(entry: AuditEntry): Promise<void>;
  list(opts: AuditListOptions): Promise<{ items: AuditRow[]; total: number }>;
}

export interface BatchesRepository {
  create(input: NewBatchRow): Promise<BatchRow>;
  findById(id: string): Promise<BatchRow | null>;
  list(opts: BatchListOptions): Promise<{ items: BatchRow[]; total: number }>;
  update(
    id: string,
    patch: Partial<NewBatchRow>,
    expectedStatus?: BatchRow["status"],
  ): Promise<BatchRow | null>;
}

export type InvoiceQuery = {
  page: number;
  perPage: number;
  moyasarStatus?: NonNullable<ItemRow["moyasarStatus"]>;
  batchId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
};

export interface ItemsRepository {
  listByBatch(batchId: string): Promise<ItemRow[]>;
  deleteByBatch(batchId: string): Promise<void>;
  insertMany(rows: NewItemRow[]): Promise<ItemRow[]>;
  countByBatch(batchId: string): Promise<{ total: number; invalid: number }>;
  markSubmitting(itemIds: string[]): Promise<void>;
  recordSubmitted(itemId: string, moyasar: { id: string; url: string | null; status: string }): Promise<void>;
  recordFailed(itemId: string, error: string): Promise<void>;
  listByBatchAndStatus(batchId: string, status: ItemRow["status"]): Promise<ItemRow[]>;
  listOpenSubmitted(): Promise<ItemRow[]>;
  syncStatus(itemId: string, moyasarStatus: NonNullable<ItemRow["moyasarStatus"]>): Promise<void>;
  findByMoyasarInvoiceId(moyasarInvoiceId: string): Promise<ItemRow | null>;
  queryInvoices(opts: InvoiceQuery): Promise<{ items: ItemRow[]; total: number }>;
}

export interface SettingsRepository {
  get(): Promise<SettingsRow>;
  update(patch: Partial<NewSettingsRow>): Promise<SettingsRow>;
}

export interface JobsRepository {
  enqueue(type: "submit_batch" | "sync_invoices", payload: Record<string, unknown>): Promise<JobRow>;
  enqueueIn(type: "submit_batch" | "sync_invoices", payload: Record<string, unknown>, delayMs: number): Promise<JobRow>;
  claimNext(workerId: string): Promise<JobRow | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, retryInMs: number | null): Promise<void>;
  listDead(): Promise<JobRow[]>;
  hasPending(type: "submit_batch" | "sync_invoices"): Promise<boolean>;
}

export interface Repositories {
  users: UsersRepository;
  sessions: SessionsRepository;
  audit: AuditRepository;
  batches: BatchesRepository;
  items: ItemsRepository;
  settings: SettingsRepository;
  jobs: JobsRepository;
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
