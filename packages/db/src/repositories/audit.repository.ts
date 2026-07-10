import { and, count, desc, eq } from "drizzle-orm";
import { auditLogs } from "../schema";
import type {
  AuditEntry,
  AuditListOptions,
  AuditRepository,
  AuditRow,
  Executor,
} from "./types";

export class DrizzleAuditRepository implements AuditRepository {
  constructor(private readonly db: Executor) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
    });
  }

  async list(opts: AuditListOptions): Promise<{ items: AuditRow[]; total: number }> {
    const filters = [
      opts.actorId ? eq(auditLogs.actorId, opts.actorId) : undefined,
      opts.action ? eq(auditLogs.action, opts.action) : undefined,
      opts.entityType ? eq(auditLogs.entityType, opts.entityType) : undefined,
    ].filter((f): f is NonNullable<typeof f> => f !== undefined);
    const where = filters.length > 0 ? and(...filters) : undefined;

    const items = await this.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(opts.perPage)
      .offset((opts.page - 1) * opts.perPage);

    const countRows = await this.db
      .select({ value: count() })
      .from(auditLogs)
      .where(where);

    return { items, total: countRows[0]?.value ?? 0 };
  }
}
