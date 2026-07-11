"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createBatchSchema, type CreateBatchInput } from "@moyasar-ops/shared";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";

export default function NewBatchPage() {
  const router = useRouter();
  const { user, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && user && !can.createBatch(user)) router.replace("/batches");
  }, [isLoading, user, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateBatchInput>({ resolver: zodResolver(createBatchSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const { batch } = await api.batches.create(values);
      router.replace(`/batches/${batch.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
        return;
      }
      throw err;
    }
  });

  if (isLoading || !user || !can.createBatch(user)) {
    return <div className="p-2 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-semibold">New batch</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name")} />
          {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" placeholder="SAR" {...register("currency")} />
          {errors.currency ? (
            <p className="text-xs text-destructive">{errors.currency.message}</p>
          ) : null}
        </div>
        <Button type="submit" disabled={isSubmitting}>
          Create batch
        </Button>
      </form>
    </div>
  );
}
