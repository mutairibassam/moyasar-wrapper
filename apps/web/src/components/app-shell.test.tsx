import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { PublicUser } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

const asUser = (over: Partial<PublicUser>): PublicUser => ({
  id: "u1",
  email: "u@example.com",
  displayName: "User",
  role: "viewer",
  isActive: true,
  ...over,
});

describe("AppShell", () => {
  test("viewer sees core nav but not admin sections", async () => {
    server.use(http.get("/api/v1/me", () => HttpResponse.json({ user: asUser({ role: "viewer" }) })));
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    expect(await screen.findByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /batches/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /invoices/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /users/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /audit/i })).not.toBeInTheDocument();
  });

  test("admin sees all nav sections", async () => {
    server.use(http.get("/api/v1/me", () => HttpResponse.json({ user: asUser({ role: "admin" }) })));
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    expect(await screen.findByRole("link", { name: /settings/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: /users/i })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /audit/i })).toBeInTheDocument();
  });
});
