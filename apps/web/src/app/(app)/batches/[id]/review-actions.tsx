"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { rejectBatchSchema, type RejectBatchInput } from "@moyasar-ops/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { BatchView, PublicUser } from "@/lib/api/types";
import { can } from "@/lib/auth/permissions";

function useBatchMutation<T>(batchId: string, fn: () => Promise<T>, onDone?: (r: T) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: qk.batch(batchId) });
      await queryClient.invalidateQueries({ queryKey: ["batches"] });
      onDone?.(result);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Action failed");
    },
  });
}

function RejectDialog({ batchId }: { batchId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RejectBatchInput>({ resolver: zodResolver(rejectBatchSchema) });

  const reject = useMutation({
    mutationFn: (comment: string) => api.batches.reject(batchId, comment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.batch(batchId) });
      await queryClient.invalidateQueries({ queryKey: ["batches"] });
      toast.success("Batch rejected");
      setOpen(false);
      reset();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Action failed");
    },
  });

  const onSubmit = handleSubmit((values) => reject.mutate(values.comment));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Reject
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject batch</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Textarea aria-label="rejection-comment" placeholder="Reason…" {...register("comment")} />
          {errors.comment ? (
            <p className="text-xs text-destructive">{errors.comment.message}</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" variant="destructive" size="sm" disabled={reject.isPending}>
              Confirm rejection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewActions({ batch, user }: { batch: BatchView; user: PublicUser | undefined }) {
  const router = useRouter();
  const isMaker = can.editBatch(user);
  const hasInvalid = batch.items.some((i) => i.status === "invalid");

  const submit = useBatchMutation(batch.id, () => api.batches.submitForApproval(batch.id), () =>
    toast.success("Submitted for approval"),
  );
  const approve = useBatchMutation(batch.id, () => api.batches.approve(batch.id), () =>
    toast.success("Batch approved"),
  );
  const refresh = useBatchMutation(
    batch.id,
    () => api.batches.refresh(batch.id),
    (r) => toast.success(`Refreshed ${r.updated} invoice(s)`),
  );
  const clone = useBatchMutation(
    batch.id,
    () => api.batches.cloneFailed(batch.id),
    (r) => router.push(`/batches/${r.batch.id}`),
  );

  const actions: React.ReactNode[] = [];

  if ((batch.status === "draft" || batch.status === "rejected") && isMaker) {
    actions.push(
      <Button
        key="submit"
        size="sm"
        disabled={batch.itemCount === 0 || hasInvalid || submit.isPending}
        onClick={() => submit.mutate()}
      >
        Submit for approval
      </Button>,
    );
  }

  if (batch.status === "pending_approval" && can.review(user, batch)) {
    actions.push(
      <ConfirmDialog
        key="approve"
        title="Approve batch?"
        description="Approved batches are queued for submission to Moyasar."
        confirmLabel="Approve"
        onConfirm={() => approve.mutate()}
        trigger={
          <Button size="sm" disabled={approve.isPending}>
            Approve
          </Button>
        }
      />,
      <RejectDialog key="reject" batchId={batch.id} />,
    );
  }

  if ((batch.status === "submitted" || batch.status === "partially_failed") && can.refresh(user)) {
    actions.push(
      <Button
        key="refresh"
        variant="outline"
        size="sm"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        Refresh statuses
      </Button>,
    );
  }

  if (batch.status === "partially_failed" && isMaker) {
    actions.push(
      <Button
        key="clone"
        variant="outline"
        size="sm"
        disabled={clone.isPending}
        onClick={() => clone.mutate()}
      >
        Clone failed batch
      </Button>,
    );
  }

  if (actions.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-2">{actions}</div>;
}
