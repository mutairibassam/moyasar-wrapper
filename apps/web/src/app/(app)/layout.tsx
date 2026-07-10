"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/auth/use-session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isError } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && (isError || !user)) router.replace("/login");
  }, [isLoading, isError, user, router]);
  if (isLoading || !user) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  return <AppShell>{children}</AppShell>;
}
