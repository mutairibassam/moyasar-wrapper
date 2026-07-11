import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { PublicUser } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import UsersPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

function meRole(role: string) {
  server.use(
    http.get("/api/v1/me", () =>
      HttpResponse.json({
        user: { id: "admin1", email: "a@e.com", displayName: "Admin", role, isActive: true } as PublicUser,
      }),
    ),
  );
}

const users: PublicUser[] = [
  { id: "u1", email: "maker@e.com", displayName: "Mia Maker", role: "maker", isActive: true },
];

describe("UsersPage", () => {
  test("lists users and creates a new one", async () => {
    meRole("admin");
    let created: unknown = null;
    server.use(
      http.get("/api/v1/users", () => HttpResponse.json({ users })),
      http.post("/api/v1/users", async ({ request }) => {
        created = await request.json();
        return HttpResponse.json(
          { user: { id: "u2", email: "new@e.com", displayName: "New", role: "viewer", isActive: true } },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<UsersPage />);
    expect(await screen.findByText("maker@e.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /add user/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/email/i), "new@e.com");
    await userEvent.type(within(dialog).getByLabelText(/display name/i), "New User");
    await userEvent.selectOptions(within(dialog).getByLabelText(/role/i), "maker");
    await userEvent.type(within(dialog).getByLabelText(/password/i), "sup3rs3cret-pw");
    await userEvent.click(within(dialog).getByRole("button", { name: /create/i }));

    await waitFor(() =>
      expect(created).toEqual({
        email: "new@e.com",
        displayName: "New User",
        role: "maker",
        password: "sup3rs3cret-pw",
      }),
    );
  });

  test("edits a user with a partial update", async () => {
    meRole("admin");
    let patched: unknown = null;
    server.use(
      http.get("/api/v1/users", () => HttpResponse.json({ users })),
      http.patch("/api/v1/users/u1", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ user: { ...users[0], isActive: false } });
      }),
    );

    renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("active")); // toggle off
    await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(patched).toEqual({ displayName: "Mia Maker", role: "maker", isActive: false }),
    );
  });

  test("redirects non-admins", async () => {
    meRole("viewer");
    renderWithProviders(<UsersPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
