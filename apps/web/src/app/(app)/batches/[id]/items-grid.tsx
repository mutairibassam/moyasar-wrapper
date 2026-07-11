"use client";

import { invoiceItemInputSchema, type InvoiceItemInput } from "@moyasar-ops/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { BatchView } from "@/lib/api/types";
import { toMajorUnits, toMinorUnits } from "@/lib/money";

type Row = { amount: string; description: string; expiredAt: string };
type RowErrors = Record<string, string>;

function batchToRows(batch: BatchView): Row[] {
  return batch.items.map((it) => ({
    amount: toMajorUnits(it.amount),
    description: it.description,
    expiredAt: it.expiredAt ? it.expiredAt.slice(0, 10) : "",
  }));
}

/** Convert a row to a validated InvoiceItemInput, collecting field errors by name. */
function validateRow(row: Row, currency: string): { input?: InvoiceItemInput; errors: RowErrors } {
  const errors: RowErrors = {};
  let amountMinor: number | undefined;
  try {
    amountMinor = toMinorUnits(row.amount);
  } catch {
    errors.amount = "Enter a valid amount";
  }
  const candidate = {
    amount: amountMinor,
    currency,
    description: row.description,
    ...(row.expiredAt ? { expiredAt: row.expiredAt } : {}),
  };
  const parsed = invoiceItemInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "amount");
      errors[key] ??= issue.message;
    }
    return { errors };
  }
  return { input: parsed.data, errors };
}

export function ItemsGrid({
  batch,
  editable,
  onSaved,
}: {
  batch: BatchView;
  editable: boolean;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => batchToRows(batch));
  const [errors, setErrors] = useState<Record<number, RowErrors>>({});

  const mutation = useMutation({
    mutationFn: (items: InvoiceItemInput[]) => api.batches.replaceItems(batch.id, items),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.batch(batch.id) });
      toast.success("Items saved");
      onSaved?.();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Failed to save items");
    },
  });

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, { amount: "", description: "", expiredAt: "" }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const onSave = () => {
    const nextErrors: Record<number, RowErrors> = {};
    const items: InvoiceItemInput[] = [];
    rows.forEach((row, i) => {
      const { input, errors: rowErrors } = validateRow(row, batch.currency);
      if (input) items.push(input);
      if (Object.keys(rowErrors).length > 0) nextErrors[i] = rowErrors;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Fix the highlighted rows before saving");
      return;
    }
    mutation.mutate(items);
  };

  if (!editable) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Expires</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batch.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                No items.
              </TableCell>
            </TableRow>
          ) : (
            batch.items.map((it) => (
              <TableRow key={it.id}>
                <TableCell>{it.rowNumber}</TableCell>
                <TableCell>{it.description}</TableCell>
                <TableCell>{it.amountFormatted}</TableCell>
                <TableCell>{it.expiredAt ? it.expiredAt.slice(0, 10) : "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Amount ({batch.currency})</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell>
                <Input
                  aria-label={`description-${i}`}
                  value={row.description}
                  onChange={(e) => setRow(i, { description: e.target.value })}
                />
                {errors[i]?.description ? (
                  <p className="mt-1 text-xs text-destructive">{errors[i]!.description}</p>
                ) : null}
              </TableCell>
              <TableCell>
                <Input
                  aria-label={`amount-${i}`}
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => setRow(i, { amount: e.target.value })}
                />
                {errors[i]?.amount ? (
                  <p className="mt-1 text-xs text-destructive">{errors[i]!.amount}</p>
                ) : null}
              </TableCell>
              <TableCell>
                <Input
                  aria-label={`expiredAt-${i}`}
                  type="date"
                  value={row.expiredAt}
                  onChange={(e) => setRow(i, { expiredAt: e.target.value })}
                />
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`remove-${i}`}
                  onClick={() => removeRow(i)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          Add row
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={mutation.isPending}>
          Save items
        </Button>
      </div>
    </div>
  );
}
