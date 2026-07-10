import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import NewBatchPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

afterEach(() => replace.mockReset());

function meRole(role: string) {
  server.use(
    http.get("/api/v1/me", () =>
      HttpResponse.json({
        user: { id: "u1", email: "u@e.com", displayName: "U", role, isActive: true },
      }),
    ),
  );
}

describe("NewBatchPage", () => {
  test("creates a batch and navigates to its detail", async () => {
    meRole("maker");
    server.use(
      http.post("/api/v1/batches", async ({ request }) => {
        const body = (await request.json()) as { name: string; currency: string };
        expect(body).toEqual({ name: "Payroll July", currency: "SAR" });
        return HttpResponse.json({ batch: { id: "b1" } }, { status: 201 });
      }),
    );

    renderWithProviders(<NewBatchPage />);
    await userEvent.type(await screen.findByLabelText(/name/i), "Payroll July");
    await userEvent.type(screen.getByLabelText(/currency/i), "SAR");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/batches/b1"));
  });

  test("shows a validation error for an invalid currency", async () => {
    meRole("maker");
    renderWithProviders(<NewBatchPage />);
    await userEvent.type(await screen.findByLabelText(/name/i), "Bad");
    await userEvent.type(screen.getByLabelText(/currency/i), "SARS");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(await screen.findByText(/3-letter ISO-4217 code/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
