import { and, count, eq, inArray } from "drizzle-orm";
import { invoiceItems, moyasarInvoiceStatusEnum } from "../schema";
import type { Executor, ItemRow, ItemsRepository, NewItemRow } from "./types";

const MOYASAR_INVOICE_STATUSES = new Set<string>(moyasarInvoiceStatusEnum.enumValues);

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

  async markSubmitting(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await this.db
      .update(invoiceItems)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(inArray(invoiceItems.id, itemIds));
  }

  async recordSubmitted(
    itemId: string,
    moyasar: { id: string; url: string | null; status: string },
  ): Promise<void> {
    const moyasarStatus = MOYASAR_INVOICE_STATUSES.has(moyasar.status)
      ? (moyasar.status as (typeof moyasarInvoiceStatusEnum.enumValues)[number])
      : null;
    await this.db
      .update(invoiceItems)
      .set({
        status: "submitted",
        moyasarInvoiceId: moyasar.id,
        moyasarUrl: moyasar.url,
        moyasarStatus,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoiceItems.id, itemId));
  }

  async recordFailed(itemId: string, error: string): Promise<void> {
    await this.db
      .update(invoiceItems)
      .set({ status: "failed", validationErrors: { submission: [error] }, updatedAt: new Date() })
      .where(eq(invoiceItems.id, itemId));
  }

  async listByBatchAndStatus(batchId: string, status: ItemRow["status"]): Promise<ItemRow[]> {
    return this.db
      .select()
      .from(invoiceItems)
      .where(and(eq(invoiceItems.batchId, batchId), eq(invoiceItems.status, status)))
      .orderBy(invoiceItems.rowNumber);
  }
}
