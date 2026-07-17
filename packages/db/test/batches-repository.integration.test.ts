import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, createRepositories, invoiceBatches, invoiceItems, users } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const repos = createRepositories(db);

test("batches + items repositories create, list, count, and update", async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `br-${Date.now()}@example.com`, displayName: "BR", role: "maker" })
    .returning();

  const batch = await repos.batches.create({
    name: "repo batch", source: "manual", currency: "SAR", createdBy: u!.id,
  });
  expect(batch.status).toBe("draft");

  await repos.items.insertMany([
    { batchId: batch.id, rowNumber: 1, amount: 14999, currency: "SAR", description: "A", status: "valid" },
    { batchId: batch.id, rowNumber: 2, amount: 100, currency: "SAR", description: "B", status: "invalid" },
  ]);

  const counts = await repos.items.countByBatch(batch.id);
  expect(counts.total).toBe(2);
  expect(counts.invalid).toBe(1);

  const listed = await repos.items.listByBatch(batch.id);
  expect(listed.map((i) => i.rowNumber)).toEqual([1, 2]);

  await repos.batches.update(batch.id, { status: "pending_approval" });
  const reread = await repos.batches.findById(batch.id);
  expect(reread?.status).toBe("pending_approval");

  const page = await repos.batches.list({ page: 1, perPage: 10, createdBy: u!.id });
  expect(page.items.some((b) => b.id === batch.id)).toBe(true);

  await db.delete(invoiceItems).where(eq(invoiceItems.batchId, batch.id));
  await db.delete(invoiceBatches).where(eq(invoiceBatches.id, batch.id));
  await db.delete(users).where(eq(users.id, u!.id));
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
