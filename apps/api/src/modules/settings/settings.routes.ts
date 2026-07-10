import { Hono } from "hono";
import { setKeySchema, setModeSchema } from "@moyasar-ops/shared";
import { ValidationError } from "../../errors";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { requireRole } from "../../middleware/rbac";

export function settingsRoutes() {
  const app = new Hono<AppEnv>();
  app.use("*", requireRole("admin"));

  app.get("/", async (c) => c.json({ settings: await c.get("container").settings.view() }));

  app.put("/keys", async (c) => {
    const parsed = setKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid key payload", parsed.error.flatten());
    await c
      .get("container")
      .settings.setKey(c.get("user")!, parsed.data.mode, parsed.data.key, { ip: clientIp(c.req.header("x-forwarded-for")) });
    return c.json({ settings: await c.get("container").settings.view() });
  });

  app.put("/mode", async (c) => {
    const parsed = setModeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid mode payload", parsed.error.flatten());
    await c
      .get("container")
      .settings.setMode(c.get("user")!, parsed.data.mode, { ip: clientIp(c.req.header("x-forwarded-for")) });
    return c.json({ settings: await c.get("container").settings.view() });
  });

  return app;
}
