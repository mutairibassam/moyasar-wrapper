import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import type { BatchStatus, BatchView, ItemView, PublicUser } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import { ReviewActions } from "./review-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const user = (over: Partial<PublicUser>): PublicUser => ({
  id: "u1",
  email: "u@e.com",
  displayName: "U",
  role: "viewer",
  isActive: true,
  ...over,
});

const draftItem: ItemView = {
  id: "i1",
  rowNumber: 1,
  amount: 20000,
  amountFormatted: "200.00 SAR",
  currency: "SAR",
  description: "A",
  expiredAt: null,
  metadata: null,
  status: "draft",
  validationErrors: null,
  moyasarInvoiceId: null,
  moyasarStatus: null,
  moyasarUrl: null,
};

const batch = (status: BatchStatus, over: Partial<BatchView> = {}): BatchView => ({
  id: "b1",
  name: "Batch",
  status,
  source: "manual",
  mode: "test",
  currency: "SAR",
  createdBy: "creator",
  approvedBy: null,
  rejectionComment: null,
  itemCount: 1,
  totalAmount: 20000,
  totalAmountFormatted: "200.00 SAR",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  items: [draftItem],
  ...over,
});

describe("ReviewActions", () => {
  test("approver sees approve/reject on someone else's pending batch", () => {
    renderWithProviders(
      <ReviewActions batch={batch("pending_approval")} user={user({ id: "a", role: "approver" })} />,
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  test("no self-approval: approver on own pending batch sees no review actions", () => {
    renderWithProviders(
      <ReviewActions
        batch={batch("pending_approval", { createdBy: "a" })}
        user={user({ id: "a", role: "approver" })}
      />,
    );
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
  });

  test("reject requires a comment and calls the reject endpoint", async () => {
    let rejectBody: unknown = null;
    server.use(
      http.post("/api/v1/batches/b1/reject", async ({ request }) => {
        rejectBody = await request.json();
        return HttpResponse.json({ batch: batch("rejected") });
      }),
    );
    renderWithProviders(
      <ReviewActions batch={batch("pending_approval")} user={user({ id: "a", role: "approver" })} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    // empty comment blocked
    await userEvent.click(screen.getByRole("button", { name: /confirm rejection/i }));
    expect(rejectBody).toBeNull();
    // valid comment submits
    await userEvent.type(screen.getByLabelText("rejection-comment"), "Wrong totals");
    await userEvent.click(screen.getByRole("button", { name: /confirm rejection/i }));
    await waitFor(() => expect(rejectBody).toEqual({ comment: "Wrong totals" }));
  });

  test("maker sees submit-for-approval on a draft with valid items", () => {
    renderWithProviders(<ReviewActions batch={batch("draft")} user={user({ role: "maker" })} />);
    expect(screen.getByRole("button", { name: /submit for approval/i })).toBeEnabled();
  });

  test("submit disabled when a batch has an invalid item", () => {
    const b = batch("draft", { items: [{ ...draftItem, status: "invalid" }] });
    renderWithProviders(<ReviewActions batch={b} user={user({ role: "maker" })} />);
    expect(screen.getByRole("button", { name: /submit for approval/i })).toBeDisabled();
  });

  test("maker sees clone-failed on a partially_failed batch", () => {
    renderWithProviders(
      <ReviewActions batch={batch("partially_failed")} user={user({ role: "maker" })} />,
    );
    expect(screen.getByRole("button", { name: /clone failed batch/i })).toBeInTheDocument();
  });
});
