import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { loginSchema } from "@moyasar-ops/shared";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { ValidationError } from "../../errors";
import { requireAuth } from "../../middleware/rbac";
import { CSRF_COOKIE } from "../../middleware/csrf";
import { SESSION_COOKIE } from "../../middleware/session";

export function authRoutes() {
  const app = new Hono<AppEnv>();

  app.post("/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError("Invalid login payload", parsed.error.flatten());

    const container = c.get("container");
    const ip = clientIp(c.req.header("x-forwarded-for")) ?? clientIp(c.req.header("x-real-ip"));
    const { token, user } = await container.auth.login(parsed.data, {
      ip,
      userAgent: c.req.header("user-agent") ?? null,
    });

    const expires = new Date(Date.now() + container.config.sessionTtlMinutes * 60_000);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: container.config.cookieSecure,
      path: "/",
      expires,
    });
    const csrf = randomBytes(32).toString("base64url");
    setCookie(c, CSRF_COOKIE, csrf, {
      httpOnly: false,
      sameSite: "Lax",
      secure: container.config.cookieSecure,
      path: "/",
      expires,
    });
    return c.json({ user });
  });

  app.post("/logout", requireAuth, async (c) => {
    const token = c.get("sessionToken");
    if (token) await c.get("container").auth.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    deleteCookie(c, CSRF_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  return app;
}
