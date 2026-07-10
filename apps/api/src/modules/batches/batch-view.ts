import type { BatchRow, ItemRow } from "@moyasar-ops/db";
import { formatMinorUnits } from "@moyasar-ops/shared";

export type ItemView = {
  id: string;
  rowNumber: number;
  amount: number;
  amountFormatted: string;
  currency: string;
  description: string;
  expiredAt: string | null;
  metadata: Record<string, string> | null;
  status: ItemRow["status"];
  validationErrors: Record<string, string[]> | null;
  moyasarInvoiceId: string | null;
  moyasarStatus: ItemRow["moyasarStatus"];
  moyasarUrl: string | null;
};

export type BatchView = {
  id: string;
  name: string;
  status: BatchRow["status"];
  source: BatchRow["source"];
  mode: BatchRow["mode"];
  currency: string;
  createdBy: string;
  approvedBy: string | null;
  rejectionComment: string | null;
  itemCount: number;
  totalAmount: number;
  totalAmountFormatted: string;
  createdAt: string;
  updatedAt: string;
  items: ItemView[];
};

export function toItemView(row: ItemRow): ItemView {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    amount: row.amount,
    amountFormatted: formatMinorUnits(row.amount, row.currency),
    currency: row.currency,
    description: row.description,
    expiredAt: row.expiredAt,
    metadata: row.metadata,
    status: row.status,
    validationErrors: row.validationErrors,
    moyasarInvoiceId: row.moyasarInvoiceId,
    moyasarStatus: row.moyasarStatus,
    moyasarUrl: row.moyasarUrl,
  };
}

export function toBatchView(batch: BatchRow, items: ItemRow[]): BatchView {
  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    source: batch.source,
    mode: batch.mode,
    currency: batch.currency,
    createdBy: batch.createdBy,
    approvedBy: batch.approvedBy,
    rejectionComment: batch.rejectionComment,
    itemCount: batch.itemCount,
    totalAmount: batch.totalAmount,
    totalAmountFormatted: formatMinorUnits(batch.totalAmount, batch.currency),
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    items: items.map(toItemView),
  };
}
