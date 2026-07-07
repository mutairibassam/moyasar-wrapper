import { and, count, desc, eq } from "drizzle-orm";
import { invoiceBatches } from "../schema";
import type {
  BatchesRepository,
  BatchListOptions,
  BatchRow,
  Executor,
  NewBatchRow,
} from "./types";

export class DrizzleBatchesRepository implements BatchesRepository {
  constructor(private readonly db: Executor) {}

  async create(input: NewBatchRow): Promise<BatchRow> {
    const [row] = await this.db.insert(invoiceBatches).values(input).returning();
    return row!;
  }

  async findById(id: string): Promise<BatchRow | null> {
    const [row] = await this.db
      .select()
      .from(invoiceBatches)
      .where(eq(invoiceBatches.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(opts: BatchListOptions): Promise<{ items: BatchRow[]; total: number }> {
    const filters = [
      opts.status ? eq(invoiceBatches.status, opts.status) : undefined,
      opts.createdBy ? eq(invoiceBatches.createdBy, opts.createdBy) : undefined,
    ].filter((f): f is NonNullable<typeof f> => f !== undefined);
    const where = filters.length > 0 ? and(...filters) : undefined;

    const items = await this.db
      .select()
      .from(invoiceBatches)
      .where(where)
      .orderBy(desc(invoiceBatches.createdAt))
      .limit(opts.perPage)
      .offset((opts.page - 1) * opts.perPage);

    const [row] = await this.db.select({ value: count() }).from(invoiceBatches).where(where);
    return { items, total: row?.value ?? 0 };
  }

  async update(id: string, patch: Partial<NewBatchRow>): Promise<BatchRow | null> {
    const [row] = await this.db
      .update(invoiceBatches)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(invoiceBatches.id, id))
      .returning();
    return row ?? null;
  }
}
