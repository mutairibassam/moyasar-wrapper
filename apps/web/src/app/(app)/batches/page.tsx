"use client";

import { BATCH_STATUSES, formatMinorUnits } from "@moyasar-ops/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { BatchSummary } from "@/lib/api/types";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";
import { formatDateTime } from "@/lib/format";

export default function BatchesPage() {
  const { user } = useSession();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const query = useMemo(() => ({ page, status: status || undefined }), [page, status]);
  const { data, isLoading } = useQuery({
    queryKey: qk.batches(query),
    queryFn: () => api.batches.list(query),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<BatchSummary, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link href={`/batches/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge kind="batch" value={row.original.status} />,
      },
      { accessorKey: "itemCount", header: "Items" },
      {
        accessorKey: "totalAmount",
        header: "Total",
        cell: ({ row }) => formatMinorUnits(row.original.totalAmount, row.original.currency),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Batches</h1>
        {can.createBatch(user) ? (
          <Button asChild size="sm">
            <Link href="/batches/new">New batch</Link>
          </Button>
        ) : null}
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="status-filter">Status</Label>
          <NativeSelect
            id="status-filter"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All</option>
            {BATCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        meta={data?.meta ?? { page, perPage: 20, total: 0, totalPages: 0 }}
        onPageChange={setPage}
        isLoading={isLoading}
        empty={<span className="text-sm text-muted-foreground">No batches found.</span>}
      />
    </div>
  );
}
