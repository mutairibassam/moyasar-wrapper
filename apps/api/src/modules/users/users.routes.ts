import { Hono } from "hono";
import { createUserSchema, updateUserSchema } from "@moyasar-ops/shared";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { ValidationError } from "../../errors";
import { requireRole } from "../../middleware/rbac";

export function usersRoutes() {
  const app = new Hono<AppEnv>();
  app.use("*", requireRole("admin"));

  app.get("/", async (c) => c.json({ users: await c.get("container").users.list() }));

  app.post("/", async (c) => {
    const parsed = createUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid user payload", parsed.error.flatten());
    const ip = clientIp(c.req.header("x-forwarded-for"));
    const user = await c.get("container").users.create(c.get("user")!, parsed.data, { ip });
    return c.json({ user }, 201);
  });

  app.patch("/:id", async (c) => {
    const parsed = updateUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid user payload", parsed.error.flatten());
    const ip = clientIp(c.req.header("x-forwarded-for"));
    const user = await c
      .get("container")
      .users.update(c.get("user")!, c.req.param("id"), parsed.data, { ip });
    return c.json({ user });
  });

  return app;
}
