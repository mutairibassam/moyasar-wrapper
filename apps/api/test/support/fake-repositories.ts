import type {
  AuditEntry,
  AuditListOptions,
  AuditRow,
  AuditRepository,
  BatchesRepository,
  BatchListOptions,
  BatchRow,
  InvoiceQuery,
  ItemRow,
  ItemsRepository,
  JobRow,
  JobsRepository,
  NewBatchRow,
  NewItemRow,
  NewSessionRow,
  NewSettingsRow,
  NewUserRow,
  Repositories,
  SessionRow,
  SessionsRepository,
  SettingsRepository,
  SettingsRow,
  UserRow,
  UsersRepository,
} from "@moyasar-ops/db";
import { uuidv7 } from "uuidv7";

export class FakeRepositories implements Repositories {
  userRows: UserRow[] = [];
  sessionRows: SessionRow[] = [];
  auditRows: (AuditEntry & { id: string; createdAt: Date })[] = [];
  batchRows: BatchRow[] = [];
  itemRows: ItemRow[] = [];
  jobRows: JobRow[] = [];
  settingsRow: SettingsRow = {
    id: 1,
    moyasarTestKeyEnc: null,
    moyasarLiveKeyEnc: null,
    webhookSecretEnc: null,
    activeMode: "test",
    updatedBy: null,
    updatedAt: new Date(),
  };

  users: UsersRepository = {
    findById: async (id) => this.userRows.find((u) => u.id === id) ?? null,
    findByEmail: async (email) => this.userRows.find((u) => u.email === email) ?? null,
    list: async () => [...this.userRows],
    create: async (input: NewUserRow) => {
      const row: UserRow = {
        id: input.id ?? uuidv7(),
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        role: input.role,
        isActive: input.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.userRows.push(row);
      return row;
    },
    update: async (id, patch: Partial<NewUserRow>) => {
      const u = this.userRows.find((x) => x.id === id);
      if (!u) return null;
      Object.assign(u, patch, { updatedAt: new Date() });
      return u;
    },
  };

  sessions: SessionsRepository = {
    create: async (input: NewSessionRow) => {
      const row: SessionRow = {
        id: input.id ?? uuidv7(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: new Date(),
      };
      this.sessionRows.push(row);
      return row;
    },
    findByTokenHash: async (h) => this.sessionRows.find((s) => s.tokenHash === h) ?? null,
    deleteByTokenHash: async (h) => {
      this.sessionRows = this.sessionRows.filter((s) => s.tokenHash !== h);
    },
    deleteByUserId: async (userId) => {
      this.sessionRows = this.sessionRows.filter((s) => s.userId !== userId);
    },
    updateExpiry: async (id, expiresAt) => {
      const s = this.sessionRows.find((x) => x.id === id);
      if (s) s.expiresAt = expiresAt;
    },
  };

  audit: AuditRepository = {
    record: async (entry: AuditEntry) => {
      this.auditRows.push({ ...entry, id: uuidv7(), createdAt: new Date() });
    },
    list: async (opts: AuditListOptions) => {
      const items = this.auditRows
        .filter((a) => (opts.actorId ? a.actorId === opts.actorId : true))
        .filter((a) => (opts.action ? a.action === opts.action : true))
        .filter((a) => (opts.entityType ? a.entityType === opts.entityType : true));
      return { items: items as unknown as AuditRow[], total: items.length };
    },
  };

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
    update: async (id: string, patch: Partial<NewBatchRow>, expectedStatus?: BatchRow["status"]) => {
      const b = this.batchRows.find((x) => x.id === id);
      if (!b) return null;
      if (expectedStatus !== undefined && b.status !== expectedStatus) return null;
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
    markSubmitting: async (itemIds: string[]) => {
      const ids = new Set(itemIds);
      for (const item of this.itemRows) {
        if (ids.has(item.id)) {
          item.status = "submitting";
          item.updatedAt = new Date();
        }
      }
    },
    recordSubmitted: async (itemId: string, moyasar: { id: string; url: string | null; status: string }) => {
      const item = this.itemRows.find((i) => i.id === itemId);
      if (!item) return;
      item.status = "submitted";
      item.moyasarInvoiceId = moyasar.id;
      item.moyasarUrl = moyasar.url;
      item.moyasarStatus = moyasar.status as ItemRow["moyasarStatus"];
      item.lastSyncedAt = new Date();
      item.updatedAt = new Date();
    },
    recordFailed: async (itemId: string, error: string) => {
      const item = this.itemRows.find((i) => i.id === itemId);
      if (!item) return;
      item.status = "failed";
      item.validationErrors = { submission: [error] };
      item.updatedAt = new Date();
    },
    listByBatchAndStatus: async (batchId: string, status: ItemRow["status"]) =>
      this.itemRows
        .filter((i) => i.batchId === batchId && i.status === status)
        .sort((a, b) => a.rowNumber - b.rowNumber),
    listOpenSubmitted: async () =>
      this.itemRows.filter((i) => i.moyasarInvoiceId !== null && (i.moyasarStatus === "initiated" || i.moyasarStatus === "on_hold")),
    syncStatus: async (itemId: string, moyasarStatus: NonNullable<ItemRow["moyasarStatus"]>) => {
      const i = this.itemRows.find((x) => x.id === itemId);
      if (i) {
        i.moyasarStatus = moyasarStatus;
        i.lastSyncedAt = new Date();
        i.updatedAt = new Date();
      }
    },
    findByMoyasarInvoiceId: async (mid: string) => this.itemRows.find((i) => i.moyasarInvoiceId === mid) ?? null,
    queryInvoices: async (opts: InvoiceQuery) => {
      const filtered = this.itemRows
        .filter((i) => i.moyasarInvoiceId !== null)
        .filter((i) => (opts.moyasarStatus ? i.moyasarStatus === opts.moyasarStatus : true))
        .filter((i) => (opts.batchId ? i.batchId === opts.batchId : true))
        .filter((i) => (opts.createdAfter ? i.createdAt >= opts.createdAfter : true))
        .filter((i) => (opts.createdBefore ? i.createdAt <= opts.createdBefore : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const start = (opts.page - 1) * opts.perPage;
      return { items: filtered.slice(start, start + opts.perPage), total: filtered.length };
    },
  };

  settings: SettingsRepository = {
    get: async () => this.settingsRow,
    update: async (patch: Partial<NewSettingsRow>) => {
      this.settingsRow = { ...this.settingsRow, ...patch, updatedAt: new Date() };
      return this.settingsRow;
    },
  };

  jobs: JobsRepository = {
    enqueue: async (type: "submit_batch" | "sync_invoices", payload: Record<string, unknown>) => {
      const row: JobRow = {
        id: uuidv7(),
        type,
        payload,
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        createdAt: new Date(),
      };
      this.jobRows.push(row);
      return row;
    },
    claimNext: async (workerId: string) => {
      const now = Date.now();
      const candidates = this.jobRows
        .filter((j) => j.status === "pending" && j.runAt.getTime() <= now)
        .sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
      const job = candidates[0];
      if (!job) return null;
      job.status = "running";
      job.lockedAt = new Date();
      job.lockedBy = workerId;
      job.attempts += 1;
      return job;
    },
    complete: async (id: string) => {
      const job = this.jobRows.find((j) => j.id === id);
      if (!job) return;
      job.status = "done";
      job.lockedAt = null;
      job.lockedBy = null;
    },
    fail: async (id: string, error: string, retryInMs: number | null) => {
      const job = this.jobRows.find((j) => j.id === id);
      if (!job) return;
      job.lastError = error;
      job.lockedAt = null;
      job.lockedBy = null;
      if (retryInMs === null) {
        job.status = "failed";
        return;
      }
      job.status = "pending";
      job.runAt = new Date(Date.now() + retryInMs);
    },
    listDead: async () => this.jobRows.filter((j) => j.status === "failed"),
  };

  async transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
