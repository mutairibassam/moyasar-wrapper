import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, createRepositories, invoiceBatches, invoiceItems, users } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const repos = createRepositories(db);

test("items repository status sync and invoice queries", async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `is-${Date.now()}@example.com`, displayName: "IS", role: "maker" })
    .returning();

  const batch = await repos.batches.create({
    name: "sync batch", source: "manual", currency: "SAR", createdBy: u!.id,
  });

  const [item1, item2] = await repos.items.insertMany([
    { batchId: batch.id, rowNumber: 1, amount: 14999, currency: "SAR", description: "A", status: "valid" },
    { batchId: batch.id, rowNumber: 2, amount: 5000, currency: "SAR", description: "B", status: "valid" },
  ]);

  await repos.items.recordSubmitted(item1!.id, { id: `inv-${item1!.id}`, url: "https://pay.example/1", status: "initiated" });
  await repos.items.recordSubmitted(item2!.id, { id: `inv-${item2!.id}`, url: "https://pay.example/2", status: "initiated" });

  const open = await repos.items.listOpenSubmitted();
  expect(open.map((i) => i.id).sort()).toEqual([item1!.id, item2!.id].sort());

  await repos.items.syncStatus(item1!.id, "paid");
  const afterSync = await repos.items.findByMoyasarInvoiceId(`inv-${item1!.id}`);
  expect(afterSync?.moyasarStatus).toBe("paid");
  expect(afterSync?.lastSyncedAt).not.toBeNull();
  expect(afterSync?.status).toBe("submitted");

  const openAfter = await repos.items.listOpenSubmitted();
  expect(openAfter.map((i) => i.id)).toEqual([item2!.id]);

  const all = await repos.items.queryInvoices({ page: 1, perPage: 10 });
  expect(all.total).toBe(2);
  expect(all.items.map((i) => i.id).sort()).toEqual([item1!.id, item2!.id].sort());

  const paidOnly = await repos.items.queryInvoices({ page: 1, perPage: 10, moyasarStatus: "paid" });
  expect(paidOnly.total).toBe(1);
  expect(paidOnly.items[0]?.id).toBe(item1!.id);

  await db.delete(invoiceItems).where(eq(invoiceItems.batchId, batch.id));
  await db.delete(invoiceBatches).where(eq(invoiceBatches.id, batch.id));
  await db.delete(users).where(eq(users.id, u!.id));
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
