import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { auditLogs, createDb } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);

test("audit_logs rows can be inserted and read", async () => {
  const [row] = await db
    .insert(auditLogs)
    .values({ actorId: null, action: "test.event", entityType: "test", entityId: "x" })
    .returning();
  expect(row!.action).toBe("test.event");
});

test("audit_logs rejects UPDATE via the append-only trigger", async () => {
  const [row] = await db
    .insert(auditLogs)
    .values({ actorId: null, action: "test.update", entityType: "test", entityId: "y" })
    .returning();
  let threw = false;
  try {
    await db.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, row!.id));
  } catch (e) {
    threw = true;
    const cause = e instanceof Error ? e.cause : undefined;
    expect(String(e) + String(cause ?? "")).toContain("append-only");
  }
  expect(threw).toBe(true);
});

test("audit_logs rejects DELETE via the append-only trigger", async () => {
  const [row] = await db
    .insert(auditLogs)
    .values({ actorId: null, action: "test.delete", entityType: "test", entityId: "z" })
    .returning();
  let threw = false;
  try {
    await db.delete(auditLogs).where(eq(auditLogs.id, row!.id));
  } catch (e) {
    threw = true;
    const cause = e instanceof Error ? e.cause : undefined;
    expect(String(e) + String(cause ?? "")).toContain("append-only");
  }
  expect(threw).toBe(true);
});

test("sessions indexes and settings singleton check exist", async () => {
  const idx = await db.execute(
    sql`SELECT indexname FROM pg_indexes WHERE tablename = 'sessions'`,
  );
  const names = idx.map((r) => (r as { indexname: string }).indexname);
  expect(names).toContain("idx_sessions_user");
  expect(names).toContain("idx_sessions_expires");

  let threw = false;
  try {
    await db.execute(sql`INSERT INTO app_settings (id) VALUES (2)`);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
