import { and, count, eq } from "drizzle-orm";
import { invoiceItems } from "../schema";
import type { Executor, ItemRow, ItemsRepository, NewItemRow } from "./types";

export class DrizzleItemsRepository implements ItemsRepository {
  constructor(private readonly db: Executor) {}

  async listByBatch(batchId: string): Promise<ItemRow[]> {
    return this.db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.batchId, batchId))
      .orderBy(invoiceItems.rowNumber);
  }

  async deleteByBatch(batchId: string): Promise<void> {
    await this.db.delete(invoiceItems).where(eq(invoiceItems.batchId, batchId));
  }

  async insertMany(rows: NewItemRow[]): Promise<ItemRow[]> {
    if (rows.length === 0) return [];
    return this.db.insert(invoiceItems).values(rows).returning();
  }

  async countByBatch(batchId: string): Promise<{ total: number; invalid: number }> {
    const [totalRow] = await this.db
      .select({ value: count() })
      .from(invoiceItems)
      .where(eq(invoiceItems.batchId, batchId));
    const [invalidRow] = await this.db
      .select({ value: count() })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.batchId, batchId), eq(invoiceItems.status, "invalid")));
    return { total: totalRow?.value ?? 0, invalid: invalidRow?.value ?? 0 };
  }
}
