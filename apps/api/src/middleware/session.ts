import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../http-context";
import { hashToken } from "../modules/auth/tokens";

export const SESSION_COOKIE = "session";

export function sessionMiddleware() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const container = c.get("container");
      const resolved = await container.auth.resolveSession(token);
      if (resolved) {
        c.set("user", resolved.user);
        c.set("sessionToken", token);
        const session = await container.repos.sessions.findByTokenHash(hashToken(token));
        if (session) {
          await container.repos.sessions.updateExpiry(session.id, resolved.slideTo);
        }
        setCookie(c, SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: "Lax",
          secure: container.config.cookieSecure,
          path: "/",
          expires: resolved.slideTo,
        });
      }
    }
    await next();
  });
}
