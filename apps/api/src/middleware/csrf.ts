import { timingSafeEqual } from "node:crypto";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { AuthzError } from "../errors";
import type { AppEnv } from "../http-context";

export const CSRF_COOKIE = "csrf_token";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Applied to mutating routes except POST /auth/login (which has no session yet).
export function csrfMiddleware() {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const cookie = getCookie(c, CSRF_COOKIE);
      const header = c.req.header("x-csrf-token");
      if (!cookie || !header || !constantTimeEqual(cookie, header)) {
        throw new AuthzError("Invalid or missing CSRF token");
      }
    }
    await next();
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
