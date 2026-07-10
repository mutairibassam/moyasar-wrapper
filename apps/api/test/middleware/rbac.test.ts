import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../src/http-context";
import { requireRole } from "../../src/middleware/rbac";
import type { PublicUser } from "../../src/modules/auth/public-user";

function appWith(user?: PublicUser) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err.message }, status as 401 | 403 | 500);
  });
  app.get("/admin", requireRole("admin"), (c) => c.json({ ok: true }));
  return app;
}

const admin: PublicUser = { id: "1", email: "a@b.c", displayName: "A", role: "admin", isActive: true };
const viewer: PublicUser = { id: "2", email: "v@b.c", displayName: "V", role: "viewer", isActive: true };

describe("requireRole", () => {
  test("401 when unauthenticated", async () => {
    const res = await appWith().request("/admin");
    expect(res.status).toBe(401);
  });
  test("403 when wrong role", async () => {
    const res = await appWith(viewer).request("/admin");
    expect(res.status).toBe(403);
  });
  test("200 when role matches", async () => {
    const res = await appWith(admin).request("/admin");
    expect(res.status).toBe(200);
  });
});
