import { Hono } from "hono";
import type { Container } from "./container";
import { AppError } from "./errors";
import type { AppEnv } from "./http-context";
import { csrfMiddleware } from "./middleware/csrf";
import { sessionMiddleware } from "./middleware/session";
import { auditRoutes } from "./modules/audit/audit.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { usersRoutes } from "./modules/users/users.routes";

type Problem = { type: string; title: string; status: number; detail?: unknown };

function problemResponse(problem: Problem): Response {
  const body: Problem = { ...problem };
  if (body.detail === undefined) delete body.detail;
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export function createApp(container: Container): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("container", container);
    await next();
  });
  app.use("*", sessionMiddleware());

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  // CSRF applies to every mutating route except POST /auth/login.
  app.use("/api/v1/*", async (c, next) => {
    if (c.req.method === "POST" && c.req.path === "/api/v1/auth/login") return next();
    return csrfMiddleware()(c, next);
  });

  app.route("/api/v1/auth", authRoutes());
  app.route("/api/v1/users", usersRoutes());
  app.route("/api/v1/audit", auditRoutes());

  app.get("/api/v1/me", async (c) => {
    const user = c.get("user");
    if (!user) return problemResponse({ type: "authentication_error", title: "Authentication required", status: 401 });
    return c.json({ user });
  });

  app.notFound(() => problemResponse({ type: "not_found", title: "Not Found", status: 404 }));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return problemResponse({ type: err.type, title: err.message, status: err.status, detail: err.detail });
    }
    console.error(`[unhandled] ${c.req.method} ${c.req.path}`, err);
    return problemResponse({ type: "internal_error", title: "Internal Server Error", status: 500 });
  });

  return app;
}
