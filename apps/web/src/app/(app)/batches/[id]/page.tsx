"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";
import { formatDateTime } from "@/lib/format";
import { CsvUpload } from "./csv-upload";
import { ItemsGrid } from "./items-grid";
import { ReviewActions } from "./review-actions";

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useSession();
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.batch(id),
    queryFn: () => api.batches.get(id),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (isError || !data) return <div className="text-sm text-destructive">Batch not found.</div>;

  const batch = data.batch;
  const editable = (batch.status === "draft" || batch.status === "rejected") && can.editBatch(user);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{batch.name}</h1>
          <StatusBadge kind="batch" value={batch.status} />
          <span className="rounded-full border px-2 py-0.5 text-xs uppercase text-muted-foreground">
            {batch.mode}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-medium">{batch.totalAmountFormatted}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Items</dt>
            <dd className="font-medium">{batch.itemCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-medium">{formatDateTime(batch.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Approved by</dt>
            <dd className="font-medium">{batch.approvedBy ?? "—"}</dd>
          </div>
        </dl>
        {batch.status === "rejected" && batch.rejectionComment ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            <span className="font-medium">Rejected:</span> {batch.rejectionComment}
          </div>
        ) : null}
      </div>

      <ReviewActions batch={batch} user={user} />

      {editable ? <CsvUpload batchId={batch.id} /> : null}

      <ItemsGrid batch={batch} editable={editable} />
    </div>
  );
}
