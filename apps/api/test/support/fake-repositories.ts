import type {
  AuditEntry,
  AuditListOptions,
  AuditRow,
  AuditRepository,
  BatchesRepository,
  BatchListOptions,
  BatchRow,
  ItemRow,
  ItemsRepository,
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
  };

  settings: SettingsRepository = {
    get: async () => this.settingsRow,
    update: async (patch: Partial<NewSettingsRow>) => {
      this.settingsRow = { ...this.settingsRow, ...patch, updatedAt: new Date() };
      return this.settingsRow;
    },
  };

  async transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
