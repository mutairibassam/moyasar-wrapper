import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, invoiceBatches, users } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);

test("inserts and reads a user and a batch with defaults", async () => {
  const email = `it-${Date.now()}@example.com`;
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: "x", displayName: "IT User", role: "maker" })
    .returning();
  expect(user!.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(user!.isActive).toBe(true);

  const [batch] = await db
    .insert(invoiceBatches)
    .values({ name: "IT batch", source: "manual", currency: "SAR", createdBy: user!.id })
    .returning();
  expect(batch!.status).toBe("draft");
  expect(batch!.totalAmount).toBe(0);

  await db.delete(invoiceBatches).where(eq(invoiceBatches.id, batch!.id));
  await db.delete(users).where(eq(users.id, user!.id));
});

afterAll(async () => {
  // postgres.js pools keep the process alive without this
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
