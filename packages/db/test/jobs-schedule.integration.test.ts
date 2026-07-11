import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { createDb, createRepositories, jobs } from "../src";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const repos = createRepositories(db);

const createdIds: string[] = [];

async function fetchById(id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}

// Any jobs left behind by other test files/runs would otherwise let
// claimNext pick up unrelated rows and break the assertions below.
beforeAll(async () => {
  await db.delete(jobs);
});

test("enqueueIn schedules run_at ~60s in the future and is not immediately claimable", async () => {
  const before = new Date();
  const job = await repos.jobs.enqueueIn("submit_batch", {}, 60_000);
  createdIds.push(job.id);

  const row = await fetchById(job.id);
  expect(row).not.toBeNull();
  const deltaMs = row!.runAt.getTime() - before.getTime();
  expect(deltaMs).toBeGreaterThan(55_000);
  expect(deltaMs).toBeLessThan(65_000);

  const claimed = await repos.jobs.claimNext("w-schedule");
  expect(claimed === null || claimed.id !== job.id).toBe(true);
});

test("hasPending is true after enqueue and false once the job is completed", async () => {
  const job = await repos.jobs.enqueue("sync_invoices", { purpose: "has-pending" });
  createdIds.push(job.id);

  const pendingBefore = await repos.jobs.hasPending("sync_invoices");
  expect(pendingBefore).toBe(true);

  const claimed = await repos.jobs.claimNext("w-has-pending");
  expect(claimed?.id).toBe(job.id);

  await repos.jobs.complete(job.id);

  const pendingAfter = await repos.jobs.hasPending("sync_invoices");
  expect(pendingAfter).toBe(false);
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(jobs).where(inArray(jobs.id, createdIds));
  }
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
