import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, invoiceBatches, invoiceItems, users } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);

test("duplicate (batch_id, row_number) is rejected", async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `uniq-${Date.now()}@example.com`, passwordHash: "x", displayName: "U", role: "maker" })
    .returning();
  const [b] = await db
    .insert(invoiceBatches)
    .values({ name: "uniq batch", source: "manual", currency: "SAR", createdBy: u!.id })
    .returning();

  await db.insert(invoiceItems).values({
    batchId: b!.id, rowNumber: 1, amount: 100, currency: "SAR", description: "row 1",
  });

  let threw = false;
  try {
    await db.insert(invoiceItems).values({
      batchId: b!.id, rowNumber: 1, amount: 200, currency: "SAR", description: "dup row 1",
    });
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);

  // A different row_number in the same batch is fine.
  await db.insert(invoiceItems).values({
    batchId: b!.id, rowNumber: 2, amount: 200, currency: "SAR", description: "row 2",
  });

  await db.delete(invoiceItems).where(eq(invoiceItems.batchId, b!.id));
  await db.delete(invoiceBatches).where(eq(invoiceBatches.id, b!.id));
  await db.delete(users).where(eq(users.id, u!.id));
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
