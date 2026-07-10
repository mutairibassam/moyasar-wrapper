"use client";

import { formatMinorUnits } from "@moyasar-ops/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { BatchStatus } from "@/lib/api/types";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const batchesQuery = useQuery({
    queryKey: qk.batches({ perPage: 100 }),
    queryFn: () => api.batches.list({ perPage: 100 }),
  });
  const openInvoicesQuery = useQuery({
    queryKey: qk.invoices({ status: "initiated", perPage: 1 }),
    queryFn: () => api.invoices.list({ status: "initiated", perPage: 1 }),
  });

  const batches = batchesQuery.data?.items ?? [];
  const counts = batches.reduce<Record<string, number>>((acc, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});
  const statuses = Object.keys(counts).sort() as BatchStatus[];
  const recent = [...batches]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Batches by status">
          {statuses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No batches yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {statuses.map((status) => (
                <li key={status} className="flex items-center justify-between text-sm">
                  <StatusBadge kind="batch" value={status} />
                  <span className="font-medium">{counts[status]}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Open invoices">
          <p className="text-3xl font-semibold">{openInvoicesQuery.data?.meta.total ?? 0}</p>
          <p className="text-xs text-muted-foreground">awaiting payment (initiated)</p>
        </Card>
        <Card title="Total batches">
          <p className="text-3xl font-semibold">{batches.length}</p>
        </Card>
      </div>
      <Card title="Recent batches">
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No batches yet.</p>
        ) : (
          <ul className="divide-y">
            {recent.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/batches/${b.id}`} className="font-medium hover:underline">
                  {b.name}
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    {formatMinorUnits(b.totalAmount, b.currency)}
                  </span>
                  <StatusBadge kind="batch" value={b.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
