import { Hono } from "hono";
import { auditQuerySchema } from "@moyasar-ops/shared";
import type { AppEnv } from "../../http-context";
import { ValidationError } from "../../errors";
import { requireRole } from "../../middleware/rbac";

export function auditRoutes() {
  const app = new Hono<AppEnv>();
  app.use("*", requireRole("admin"));

  app.get("/", async (c) => {
    const parsed = auditQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) throw new ValidationError("Invalid audit query", parsed.error.flatten());
    const { page, perPage, actorId, action, entityType } = parsed.data;
    const { items, total } = await c
      .get("container")
      .repos.audit.list({ page, perPage, actorId, action, entityType });
    return c.json({
      items,
      meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  });

  return app;
}
