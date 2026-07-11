"use client";

import { MOYASAR_INVOICE_STATUSES } from "@moyasar-ops/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { ItemView } from "@/lib/api/types";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";

function CancelInvoice({ item }: { item: ItemView }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.invoices.cancel(item.moyasarInvoiceId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice canceled");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Cancel failed"),
  });
  return (
    <ConfirmDialog
      title="Cancel invoice?"
      description="This cancels the invoice at Moyasar. It cannot be undone."
      confirmLabel="Cancel invoice"
      destructive
      onConfirm={() => mutation.mutate()}
      trigger={
        <Button variant="outline" size="sm" disabled={mutation.isPending}>
          Cancel
        </Button>
      }
    />
  );
}

export default function InvoicesPage() {
  const { user } = useSession();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [batchId, setBatchId] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");

  const query = useMemo(
    () => ({
      page,
      status: status || undefined,
      batchId: batchId || undefined,
      createdAfter: after ? `${after}T00:00:00.000Z` : undefined,
      createdBefore: before ? `${before}T23:59:59.999Z` : undefined,
    }),
    [page, status, batchId, after, before],
  );

  const { data, isLoading } = useQuery({
    queryKey: qk.invoices(query),
    queryFn: () => api.invoices.list(query),
    placeholderData: keepPreviousData,
  });

  const canCancel = can.cancelInvoice(user);
  const columns = useMemo<ColumnDef<ItemView, unknown>[]>(
    () => [
      { accessorKey: "rowNumber", header: "#" },
      { accessorKey: "description", header: "Description" },
      { accessorKey: "amountFormatted", header: "Amount" },
      {
        accessorKey: "moyasarStatus",
        header: "Status",
        cell: ({ row }) =>
          row.original.moyasarStatus ? (
            <StatusBadge kind="moyasar" value={row.original.moyasarStatus} />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "moyasarInvoiceId",
        header: "Invoice",
        cell: ({ row }) =>
          row.original.moyasarUrl ? (
            <a
              href={row.original.moyasarUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              {row.original.moyasarInvoiceId}
            </a>
          ) : (
            (row.original.moyasarInvoiceId ?? "—")
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canCancel &&
          row.original.moyasarStatus === "initiated" &&
          row.original.moyasarInvoiceId ? (
            <CancelInvoice item={row.original} />
          ) : null,
      },
    ],
    [canCancel],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Invoices</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <NativeSelect
            id="status"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All</option>
            {MOYASAR_INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="batchId">Batch ID</Label>
          <Input
            id="batchId"
            value={batchId}
            onChange={(e) => {
              setPage(1);
              setBatchId(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="after">Created after</Label>
          <Input
            id="after"
            type="date"
            value={after}
            onChange={(e) => {
              setPage(1);
              setAfter(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="before">Created before</Label>
          <Input
            id="before"
            type="date"
            value={before}
            onChange={(e) => {
              setPage(1);
              setBefore(e.target.value);
            }}
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        meta={data?.meta ?? { page, perPage: 25, total: 0, totalPages: 0 }}
        onPageChange={setPage}
        isLoading={isLoading}
        empty={<span className="text-sm text-muted-foreground">No invoices found.</span>}
      />
    </div>
  );
}
