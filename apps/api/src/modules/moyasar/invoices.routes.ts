import { Hono } from "hono";
import { invoicesQuerySchema } from "@moyasar-ops/shared";
import { ValidationError } from "../../errors";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { requireAuth, requireRole } from "../../middleware/rbac";

export function invoicesRoutes() {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const parsed = invoicesQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) throw new ValidationError("Invalid invoices query", parsed.error.flatten());
    return c.json(await c.get("container").invoices.list({
      page: parsed.data.page,
      perPage: parsed.data.perPage,
      moyasarStatus: parsed.data.status,
      batchId: parsed.data.batchId,
      createdAfter: parsed.data.createdAfter ? new Date(parsed.data.createdAfter) : undefined,
      createdBefore: parsed.data.createdBefore ? new Date(parsed.data.createdBefore) : undefined,
    }));
  });

  app.post("/:moyasarInvoiceId/cancel", requireRole("approver", "admin"), async (c) => {
    const view = await c.get("container").invoices.cancel(
      c.get("user")!,
      c.req.param("moyasarInvoiceId"),
      { ip: clientIp(c.req.header("x-forwarded-for")) },
    );
    return c.json({ invoice: view });
  });

  return app;
}
