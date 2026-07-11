import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import type { BatchSummary } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import DashboardPage from "./page";

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

describe("DashboardPage", () => {
  test("renders status counts, open-invoice total and recent batches", async () => {
    server.use(
      http.get("/api/v1/batches", () =>
        HttpResponse.json({
          items: [
            batch({ id: "b1", name: "Payroll", status: "submitted" }),
            batch({ id: "b2", name: "Refunds", status: "draft" }),
            batch({ id: "b3", name: "Vendors", status: "draft" }),
          ],
          meta: { page: 1, perPage: 100, total: 3, totalPages: 1 },
        }),
      ),
      http.get("/api/v1/invoices", () =>
        HttpResponse.json({ items: [], meta: { page: 1, perPage: 1, total: 7, totalPages: 7 } }),
      ),
    );

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Payroll")).toBeInTheDocument();
    expect(screen.getByText("Refunds")).toBeInTheDocument();
    expect(screen.getByText("Vendors")).toBeInTheDocument();
    // open invoices total from meta
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
