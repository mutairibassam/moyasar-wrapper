"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { PublicUser } from "@/lib/api/types";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  visible: (u: PublicUser | undefined) => boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, visible: (u) => !!u },
  { href: "/batches", label: "Batches", icon: ClipboardList, visible: (u) => !!u },
  { href: "/invoices", label: "Invoices", icon: FileText, visible: (u) => !!u },
  { href: "/settings", label: "Settings", icon: Settings, visible: can.admin },
  { href: "/users", label: "Users", icon: Users, visible: can.admin },
  { href: "/audit", label: "Audit", icon: ListChecks, visible: can.admin },
];

function ModeBadge() {
  const { user } = useSession();
  const enabled = can.admin(user);
  const { data } = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.settings.get(),
    enabled,
  });
  if (!enabled || !data) return null;
  const mode = data.settings.activeMode;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase",
        mode === "live"
          ? "bg-green-100 text-green-800 border-green-200"
          : "bg-amber-100 text-amber-800 border-amber-200",
      )}
    >
      {mode}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const onLogout = async () => {
    try {
      await api.auth.logout();
    } finally {
      queryClient.clear();
      router.replace("/login");
    }
  };

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r p-4">
        <div className="mb-6 px-2 text-sm font-semibold">Moyasar Ops</div>
        <nav className="space-y-1">
          {NAV.filter((item) => item.visible(user)).map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <ModeBadge />
          <div className="flex items-center gap-3">
            {user ? (
              <div className="text-right text-sm">
                <div className="font-medium">{user.displayName}</div>
                <div className="text-xs capitalize text-muted-foreground">{user.role}</div>
              </div>
            ) : null}
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="size-4" />
              Logout
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
