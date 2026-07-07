import { createMiddleware } from "hono/factory";
import type { UserRole } from "@moyasar-ops/shared";
import { AuthnError, AuthzError } from "../errors";
import type { AppEnv } from "../http-context";

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) throw new AuthnError("Authentication required");
  await next();
});

export function requireRole(...roles: UserRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new AuthnError("Authentication required");
    if (!roles.includes(user.role)) {
      throw new AuthzError("You do not have permission to perform this action");
    }
    await next();
  });
}
