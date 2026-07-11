import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { PublicUser, SettingsView } from "@/lib/api/types";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/utils";
import SettingsPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

function meRole(role: string) {
  server.use(
    http.get("/api/v1/me", () =>
      HttpResponse.json({
        user: { id: "u1", email: "u@e.com", displayName: "U", role, isActive: true } as PublicUser,
      }),
    ),
  );
}

function settings(over: Partial<SettingsView> = {}) {
  const value: SettingsView = {
    activeMode: "test",
    testKeySet: true,
    liveKeySet: false,
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...over,
  };
  server.use(http.get("/api/v1/settings", () => HttpResponse.json({ settings: value })));
}

describe("SettingsPage", () => {
  test("shows masked key indicators and saves the live key", async () => {
    meRole("admin");
    settings();
    let keyBody: unknown = null;
    server.use(
      http.put("/api/v1/settings/keys", async ({ request }) => {
        keyBody = await request.json();
        return HttpResponse.json({ settings: { activeMode: "test", testKeySet: true, liveKeySet: true, updatedAt: "" } });
      }),
    );

    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText("configured")).toBeInTheDocument();
    expect(screen.getByText("not set")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/new live secret key/i), "sk_live_123");
    const liveSection = screen.getByLabelText(/new live secret key/i).closest("div")!.parentElement!;
    await userEvent.click(within(liveSection).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(keyBody).toEqual({ mode: "live", key: "sk_live_123" }));
  });

  test("switching mode to live requires confirmation", async () => {
    meRole("admin");
    settings();
    let modeBody: unknown = null;
    server.use(
      http.put("/api/v1/settings/mode", async ({ request }) => {
        modeBody = await request.json();
        return HttpResponse.json({ settings: { activeMode: "live", testKeySet: true, liveKeySet: true, updatedAt: "" } });
      }),
    );

    renderWithProviders(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /switch to live/i }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /switch mode/i }));
    await waitFor(() => expect(modeBody).toEqual({ mode: "live" }));
  });

  test("redirects non-admins", async () => {
    meRole("maker");
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
