import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { AuditEntry, PublicUser } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import AuditPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

function meRole(role: string) {
  server.use(
    http.get("/api/v1/me", () =>
      HttpResponse.json({
        user: { id: "admin1", email: "a@e.com", displayName: "Admin", role, isActive: true } as PublicUser,
      }),
    ),
  );
}

const entry: AuditEntry = {
  id: "a1",
  actorId: "admin1",
  action: "batch.approved",
  entityType: "batch",
  entityId: "b1",
  before: { status: "pending_approval" },
  after: { status: "approved" },
  ip: "127.0.0.1",
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("AuditPage", () => {
  test("renders entries and the action filter drives the query", async () => {
    meRole("admin");
    let seenAction: string | null = "unset";
    server.use(
      http.get("/api/v1/audit", ({ request }) => {
        seenAction = new URL(request.url).searchParams.get("action");
        return HttpResponse.json({
          items: [entry],
          meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        });
      }),
    );

    renderWithProviders(<AuditPage />);
    expect(await screen.findByText("batch.approved")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^action$/i), "batch.rejected");
    await waitFor(() => expect(seenAction).toBe("batch.rejected"));
  });

  test("row details dialog shows before/after JSON", async () => {
    meRole("admin");
    server.use(
      http.get("/api/v1/audit", () =>
        HttpResponse.json({
          items: [entry],
          meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderWithProviders(<AuditPage />);
    await userEvent.click(await screen.findByRole("button", { name: /details/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/"status": "pending_approval"/)).toBeInTheDocument();
    expect(within(dialog).getByText(/"status": "approved"/)).toBeInTheDocument();
  });
});
