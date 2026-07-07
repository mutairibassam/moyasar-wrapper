import type { auditLogs, sessions, users } from "../schema";
import type { Db } from "../client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type AuditRow = typeof auditLogs.$inferSelect;

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
  list(): Promise<UserRow[]>;
  create(input: NewUserRow): Promise<UserRow>;
  update(id: string, patch: Partial<NewUserRow>): Promise<UserRow | null>;
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

export interface Repositories {
  users: UsersRepository;
  sessions: SessionsRepository;
  audit: AuditRepository;
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
