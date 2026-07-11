import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import { server } from "@/test/msw/server";
import { ApiError, apiFetch } from "./client";

describe("apiFetch", () => {
  test("returns parsed JSON on success", async () => {
    server.use(http.get("/api/v1/me", () => HttpResponse.json({ user: { id: "u1" } })));
    await expect(apiFetch("/me")).resolves.toEqual({ user: { id: "u1" } });
  });

  test("sends x-csrf-token from cookie on mutations", async () => {
    document.cookie = "csrf_token=tok-123";
    let seen: string | null = null;
    server.use(
      http.post("/api/v1/batches", ({ request }) => {
        seen = request.headers.get("x-csrf-token");
        return HttpResponse.json({ batch: {} }, { status: 201 });
      }),
    );
    await apiFetch("/batches", { method: "POST", body: { name: "x", currency: "SAR" } });
    expect(seen).toBe("tok-123");
  });

  test("throws ApiError carrying problem+json fields", async () => {
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          {
            type: "validation_error",
            title: "Invalid",
            status: 422,
            detail: { fieldErrors: { email: ["bad"] } },
          },
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    const err = (await apiFetch("/auth/login", { method: "POST", body: {} }).catch(
      (e) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.fieldErrors()).toEqual({ email: ["bad"] });
  });

  test("returns undefined for 204 responses", async () => {
    server.use(http.post("/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })));
    await expect(apiFetch("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});
