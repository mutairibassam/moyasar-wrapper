import { Hono } from "hono";
import {
  createBatchSchema,
  listBatchesQuerySchema,
  rejectBatchSchema,
  replaceItemsSchema,
} from "@moyasar-ops/shared";
import { ValidationError } from "../../errors";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { requireAuth, requireRole } from "../../middleware/rbac";

export function batchesRoutes() {
  const app = new Hono<AppEnv>();
  const ipOf = (c: { req: { header(name: string): string | undefined } }) =>
    clientIp(c.req.header("x-forwarded-for"));

  // All batch routes require authentication.
  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const parsed = listBatchesQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) throw new ValidationError("Invalid query", parsed.error.flatten());
    const result = await c.get("container").batches.list(c.get("user")!, parsed.data);
    return c.json(result);
  });

  app.post("/", requireRole("maker", "admin"), async (c) => {
    const parsed = createBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid batch payload", parsed.error.flatten());
    const view = await c.get("container").batches.create(c.get("user")!, parsed.data, { ip: ipOf(c) });
    return c.json({ batch: view }, 201);
  });

  app.get("/:id", async (c) => {
    const view = await c.get("container").batches.get(c.get("user")!, c.req.param("id"));
    return c.json({ batch: view });
  });

  app.patch("/:id/items", requireRole("maker", "admin"), async (c) => {
    const parsed = replaceItemsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid items payload", parsed.error.flatten());
    const view = await c
      .get("container")
      .batches.replaceItems(c.get("user")!, c.req.param("id"), parsed.data.items, { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/csv", requireRole("maker", "admin"), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new ValidationError("Expected a multipart file field named 'file'");
    const text = await file.text();
    const view = await c
      .get("container")
      .batches.ingestCsv(c.get("user")!, c.req.param("id"), text, { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/submit-for-approval", requireRole("maker", "admin"), async (c) => {
    const view = await c
      .get("container")
      .batches.submitForApproval(c.get("user")!, c.req.param("id"), { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/approve", requireRole("approver", "admin"), async (c) => {
    const view = await c
      .get("container")
      .batches.approve(c.get("user")!, c.req.param("id"), { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/reject", requireRole("approver", "admin"), async (c) => {
    const parsed = rejectBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("A rejection comment is required", parsed.error.flatten());
    const view = await c
      .get("container")
      .batches.reject(c.get("user")!, c.req.param("id"), parsed.data.comment, { ip: ipOf(c) });
    return c.json({ batch: view });
  });

  app.post("/:id/clone-failed", requireRole("maker", "admin"), async (c) => {
    const view = await c
      .get("container")
      .batches.cloneFailed(c.get("user")!, c.req.param("id"), { ip: ipOf(c) });
    return c.json({ batch: view }, 201);
  });

  return app;
}
