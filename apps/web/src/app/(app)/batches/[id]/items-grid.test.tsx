import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import type { BatchView, ItemView } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import { ItemsGrid } from "./items-grid";

const item = (over: Partial<ItemView>): ItemView => ({
  id: "i1",
  rowNumber: 1,
  amount: 20000,
  amountFormatted: "200.00 SAR",
  currency: "SAR",
  description: "Invoice A",
  expiredAt: null,
  metadata: null,
  status: "draft",
  validationErrors: null,
  moyasarInvoiceId: null,
  moyasarStatus: null,
  moyasarUrl: null,
  ...over,
});

const batch = (items: ItemView[]): BatchView => ({
  id: "b1",
  name: "Batch",
  status: "draft",
  source: "manual",
  mode: "test",
  currency: "SAR",
  createdBy: "u1",
  approvedBy: null,
  rejectionComment: null,
  itemCount: items.length,
  totalAmount: items.reduce((s, i) => s + i.amount, 0),
  totalAmountFormatted: "200.00 SAR",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  items,
});

describe("ItemsGrid", () => {
  test("edits a row and saves items in minor units", async () => {
    let sent: unknown = null;
    server.use(
      http.patch("/api/v1/batches/b1/items", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ batch: batch([item({})]) });
      }),
    );

    renderWithProviders(<ItemsGrid batch={batch([item({})])} editable />);
    const amount = screen.getByLabelText("amount-0");
    await userEvent.clear(amount);
    await userEvent.type(amount, "12.50");
    await userEvent.click(screen.getByRole("button", { name: /save items/i }));

    await waitFor(() =>
      expect(sent).toEqual({
        items: [{ amount: 1250, currency: "SAR", description: "Invoice A" }],
      }),
    );
  });

  test("blocks save and shows a field error when amount is below the minimum", async () => {
    let called = false;
    server.use(
      http.patch("/api/v1/batches/b1/items", () => {
        called = true;
        return HttpResponse.json({ batch: batch([]) });
      }),
    );

    renderWithProviders(<ItemsGrid batch={batch([item({})])} editable />);
    const amount = screen.getByLabelText("amount-0");
    await userEvent.clear(amount);
    await userEvent.type(amount, "0.50"); // 50 minor units < 100 minimum
    await userEvent.click(screen.getByRole("button", { name: /save items/i }));

    expect(await screen.findByText(/minimum amount is 100 minor units/i)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  test("renders read-only when not editable", () => {
    renderWithProviders(<ItemsGrid batch={batch([item({})])} editable={false} />);
    expect(screen.queryByLabelText("amount-0")).not.toBeInTheDocument();
    expect(screen.getByText("200.00 SAR")).toBeInTheDocument();
  });
});
