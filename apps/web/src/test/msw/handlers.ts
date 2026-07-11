import { http, HttpResponse } from "msw";
import type { PublicUser } from "@/lib/api/types";

/** A default authenticated viewer; component tests override per case with server.use(...). */
export const viewer: PublicUser = {
  id: "viewer-1",
  email: "viewer@example.com",
  displayName: "Val Viewer",
  role: "viewer",
  isActive: true,
};

const emptyPage = { meta: { page: 1, perPage: 20, total: 0, totalPages: 0 } };

/** Happy-path defaults: authenticated as a viewer with empty collections. */
export const handlers = [
  http.get("/api/v1/me", () => HttpResponse.json({ user: viewer })),
  http.get("/api/v1/batches", () => HttpResponse.json({ items: [], ...emptyPage })),
  http.get("/api/v1/invoices", () => HttpResponse.json({ items: [], ...emptyPage })),
  http.get("/api/v1/audit", () => HttpResponse.json({ items: [], ...emptyPage })),
  http.get("/api/v1/users", () => HttpResponse.json({ users: [] })),
  http.get("/api/v1/settings", () =>
    HttpResponse.json({
      settings: { activeMode: "test", testKeySet: false, liveKeySet: false, updatedAt: "" },
    }),
  ),
];
