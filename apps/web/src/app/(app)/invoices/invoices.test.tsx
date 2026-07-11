import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { ItemView, PublicUser } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import InvoicesPage from "./page";

const item = (over: Partial<ItemView>): ItemView => ({
  id: "i1",
  rowNumber: 1,
  amount: 20000,
  amountFormatted: "200.00 SAR",
  currency: "SAR",
  description: "Invoice A",
  expiredAt: null,
  metadata: null,
  status: "submitted",
  validationErrors: null,
  moyasarInvoiceId: "inv_1",
  moyasarStatus: "initiated",
  moyasarUrl: "https://moyasar.test/inv_1",
  ...over,
});

function meRole(role: string) {
  server.use(
    http.get("/api/v1/me", () =>
      HttpResponse.json({
        user: { id: "u1", email: "u@e.com", displayName: "U", role, isActive: true } as PublicUser,
      }),
    ),
  );
}

describe("InvoicesPage", () => {
  test("renders invoices and status filter drives the query", async () => {
    meRole("approver");
    let seenStatus: string | null = "unset";
    server.use(
      http.get("/api/v1/invoices", ({ request }) => {
        seenStatus = new URL(request.url).searchParams.get("status");
        return HttpResponse.json({
          items: [item({})],
          meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        });
      }),
    );

    renderWithProviders(<InvoicesPage />);
    expect(await screen.findByText("Invoice A")).toBeInTheDocument();
    expect(screen.getByText("initiated", { selector: "span" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/status/i), "paid");
    await waitFor(() => expect(seenStatus).toBe("paid"));
  });

  test("cancel is offered to approver on initiated invoices and calls the endpoint", async () => {
    meRole("approver");
    let canceledId: string | null = null;
    server.use(
      http.get("/api/v1/invoices", () =>
        HttpResponse.json({
          items: [item({})],
          meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        }),
      ),
      http.post("/api/v1/invoices/inv_1/cancel", () => {
        canceledId = "inv_1";
        return HttpResponse.json({ invoice: item({ moyasarStatus: "canceled" }) });
      }),
    );

    renderWithProviders(<InvoicesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel invoice/i }));
    await waitFor(() => expect(canceledId).toBe("inv_1"));
  });

  test("viewer never sees a cancel action", async () => {
    meRole("viewer");
    server.use(
      http.get("/api/v1/invoices", () =>
        HttpResponse.json({
          items: [item({})],
          meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        }),
      ),
    );
    renderWithProviders(<InvoicesPage />);
    expect(await screen.findByText("Invoice A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
  });
});
