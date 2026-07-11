import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import { LoginForm } from "./login-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

afterEach(() => replace.mockReset());

describe("LoginForm", () => {
  test("logs in and navigates to dashboard on success", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json({
          user: {
            id: "u1",
            email: "admin@example.com",
            displayName: "Admin",
            role: "admin",
            isActive: true,
          },
        }),
      ),
    );
    renderWithProviders(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  test("shows the problem title on invalid credentials", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          { type: "invalid_credentials", title: "Invalid email or password", status: 401 },
          { status: 401, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    renderWithProviders(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong-password-xx");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(replace).not.toHaveBeenCalled();
  });
});
