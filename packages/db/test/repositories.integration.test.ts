import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb, createRepositories, users } from "../src";

const url =
  process.env.DATABASE_URL ??
  "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const repos = createRepositories(db);

test("users repository creates, finds by email, updates", async () => {
  const email = `repo-${Date.now()}@example.com`;
  const created = await repos.users.create({
    email,
    displayName: "Repo User",
    role: "maker",
  });
  const found = await repos.users.findByEmail(email);
  expect(found?.id).toBe(created.id);

  const updated = await repos.users.update(created.id, { role: "approver" });
  expect(updated?.role).toBe("approver");

  await db.delete(users).where(eq(users.id, created.id));
});

test("transaction commits mutation and audit row together", async () => {
  const email = `tx-${Date.now()}@example.com`;
  const userId = await repos.transaction(async (r) => {
    const u = await r.users.create({
      email,
      displayName: "Tx User",
      role: "viewer",
    });
    await r.audit.record({
      actorId: u.id,
      action: "user.created",
      entityType: "user",
      entityId: u.id,
    });
    return u.id;
  });

  const audit = await repos.audit.list({ page: 1, perPage: 10, entityType: "user", actorId: userId });
  expect(audit.items.some((a) => a.entityId === userId)).toBe(true);

  // audit_logs is append-only (DB trigger blocks UPDATE/DELETE), and the
  // audit row's actor_id FK now references this user, so neither row can be
  // cleaned up here — that is the intended, permanent effect of an audit
  // trail. The user/email are uniquely timestamped test fixtures.
});

test("transaction rolls back mutation when the body throws", async () => {
  const email = `rollback-${Date.now()}@example.com`;
  let threw = false;
  try {
    await repos.transaction(async (r) => {
      await r.users.create({ email, displayName: "Rollback", role: "viewer" });
      throw new Error("boom");
    });
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
  const found = await repos.users.findByEmail(email);
  expect(found).toBeNull();
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
