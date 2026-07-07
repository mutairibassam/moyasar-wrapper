import type {
  AuditEntry,
  AuditListOptions,
  AuditRow,
  AuditRepository,
  NewSessionRow,
  NewUserRow,
  Repositories,
  SessionRow,
  SessionsRepository,
  UserRow,
  UsersRepository,
} from "@moyasar-ops/db";
import { uuidv7 } from "uuidv7";

export class FakeRepositories implements Repositories {
  userRows: UserRow[] = [];
  sessionRows: SessionRow[] = [];
  auditRows: (AuditEntry & { id: string; createdAt: Date })[] = [];

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

  async transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
