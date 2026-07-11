"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { AuditEntry } from "@/lib/api/types";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";
import { formatDateTime } from "@/lib/format";

function DetailsDialog({ entry }: { entry: AuditEntry }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Details
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {entry.action} · {entry.entityType}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Before</p>
            <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(entry.before, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">After</p>
            <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(entry.after, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AuditPage() {
  const router = useRouter();
  const { user, isLoading } = useSession();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actorId, setActorId] = useState("");

  useEffect(() => {
    if (!isLoading && user && !can.admin(user)) router.replace("/");
  }, [isLoading, user, router]);

  const query = useMemo(
    () => ({
      page,
      action: action || undefined,
      entityType: entityType || undefined,
      actorId: actorId || undefined,
    }),
    [page, action, entityType, actorId],
  );

  const { data, isLoading: auditLoading } = useQuery({
    queryKey: qk.audit(query),
    queryFn: () => api.audit.list(query),
    enabled: can.admin(user),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      { accessorKey: "action", header: "Action" },
      { accessorKey: "entityType", header: "Entity" },
      { accessorKey: "entityId", header: "Entity ID" },
      {
        accessorKey: "actorId",
        header: "Actor",
        cell: ({ row }) => row.original.actorId ?? "system",
      },
      { id: "details", header: "", cell: ({ row }) => <DetailsDialog entry={row.original} /> },
    ],
    [],
  );

  if (isLoading || !user || !can.admin(user)) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="action">Action</Label>
          <Input
            id="action"
            value={action}
            onChange={(e) => {
              setPage(1);
              setAction(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entityType">Entity type</Label>
          <Input
            id="entityType"
            value={entityType}
            onChange={(e) => {
              setPage(1);
              setEntityType(e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="actorId">Actor ID</Label>
          <Input
            id="actorId"
            value={actorId}
            onChange={(e) => {
              setPage(1);
              setActorId(e.target.value);
            }}
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        meta={data?.meta ?? { page, perPage: 25, total: 0, totalPages: 0 }}
        onPageChange={setPage}
        isLoading={auditLoading}
        empty={<span className="text-sm text-muted-foreground">No audit entries.</span>}
      />
    </div>
  );
}
