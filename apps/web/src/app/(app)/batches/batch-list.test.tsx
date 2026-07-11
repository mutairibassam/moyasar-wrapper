import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import type { BatchSummary, PublicUser } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import BatchesPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const batch = (over: Partial<BatchSummary>): BatchSummary => ({
  id: "b1",
  name: "Batch",
  status: "draft",
  currency: "SAR",
  itemCount: 2,
  totalAmount: 20000,
  createdBy: "u1",
  createdAt: "2026-07-10T00:00:00.000Z",
  ...over,
});

function meSession(user: Partial<PublicUser>) {
  server.use(
    http.get("/api/v1/me", () =>
      HttpResponse.json({
        user: {
          id: "u1",
          email: "u@example.com",
          displayName: "User",
          role: "viewer",
          isActive: true,
          ...user,
        },
      }),
    ),
  );
}

describe("BatchesPage", () => {
  test("renders batches and status filter drives the query", async () => {
    meSession({ role: "maker" });
    let seenStatus: string | null = "unset";
    server.use(
      http.get("/api/v1/batches", ({ request }) => {
        seenStatus = new URL(request.url).searchParams.get("status");
        return HttpResponse.json({
          items: [batch({ id: "b1", name: "Payroll", status: "submitted" })],
          meta: { page: 1, perPage: 20, total: 1, totalPages: 1 },
        });
      }),
    );

    renderWithProviders(<BatchesPage />);
    expect(await screen.findByText("Payroll")).toBeInTheDocument();
    expect(screen.getByText("submitted", { selector: "span" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "rejected");
    await waitFor(() => expect(seenStatus).toBe("rejected"));
  });

  test("shows New batch for maker, hides it for viewer", async () => {
    meSession({ role: "maker" });
    server.use(
      http.get("/api/v1/batches", () =>
        HttpResponse.json({ items: [], meta: { page: 1, perPage: 20, total: 0, totalPages: 0 } }),
      ),
    );
    const { unmount } = renderWithProviders(<BatchesPage />);
    expect(await screen.findByRole("link", { name: /new batch/i })).toBeInTheDocument();
    unmount();

    meSession({ role: "viewer" });
    renderWithProviders(<BatchesPage />);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /new batch/i })).not.toBeInTheDocument(),
    );
  });
});
