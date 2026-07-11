"use client";

import { MODES } from "@moyasar-ops/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";

function KeyForm({ mode, isSet }: { mode: (typeof MODES)[number]; isSet: boolean }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.settings.setKey(mode, key),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.settings });
      toast.success(`${mode} key updated`);
      setKey("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to save key"),
  });
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium capitalize">{mode} key</span>
        <span className={isSet ? "text-sm text-green-700" : "text-sm text-muted-foreground"}>
          {isSet ? "configured" : "not set"}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`${mode}-key`}>New {mode} secret key</Label>
          <Input
            id={`${mode}-key`}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk_…"
          />
        </div>
        <Button size="sm" disabled={key.length === 0 || mutation.isPending} onClick={() => mutation.mutate()}>
          Save
        </Button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoading } = useSession();
  const [confirmMode, setConfirmMode] = useState<(typeof MODES)[number] | null>(null);

  useEffect(() => {
    if (!isLoading && user && !can.admin(user)) router.replace("/");
  }, [isLoading, user, router]);

  const { data } = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.settings.get(),
    enabled: can.admin(user),
  });

  const setMode = useMutation({
    mutationFn: (mode: (typeof MODES)[number]) => api.settings.setMode(mode),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.settings });
      toast.success("Active mode updated");
      setConfirmMode(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to switch mode"),
  });

  if (isLoading || !user || !can.admin(user)) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (!data) return <div className="text-sm text-muted-foreground">Loading settings…</div>;

  const settings = data.settings;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Active mode</h2>
        <div className="flex items-center gap-3">
          <span className="rounded-full border px-2 py-0.5 text-xs uppercase">
            {settings.activeMode}
          </span>
          {MODES.filter((m) => m !== settings.activeMode).map((m) => (
            <Button key={m} variant="outline" size="sm" onClick={() => setConfirmMode(m)}>
              Switch to {m}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">API keys</h2>
        <KeyForm mode="test" isSet={settings.testKeySet} />
        <KeyForm mode="live" isSet={settings.liveKeySet} />
      </section>

      <ConfirmDialog
        open={confirmMode !== null}
        onOpenChange={(o) => !o && setConfirmMode(null)}
        title={`Switch active mode to ${confirmMode ?? ""}?`}
        description={
          confirmMode === "live"
            ? "New invoices will hit real Moyasar and charge real cards."
            : "New invoices will use the Moyasar test environment."
        }
        confirmLabel="Switch mode"
        destructive={confirmMode === "live"}
        onConfirm={() => confirmMode && setMode.mutate(confirmMode)}
      />
    </div>
  );
}
