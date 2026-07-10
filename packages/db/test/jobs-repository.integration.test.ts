import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { createDb, createRepositories, jobs } from "../src";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const repos = createRepositories(db);

const createdIds: string[] = [];

// claimNext's atomic UPDATE...RETURNING runs through db.execute(sql`...`),
// which (unlike the drizzle query builder) returns raw snake_case columns
// from postgres-js rather than the camelCase-mapped JobRow shape. Re-fetch
// through the query builder whenever we need to assert on fields beyond
// id/status/attempts to sidestep that quirk.
async function fetchById(id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}

// Any jobs left behind by other test files/runs would otherwise let
// claimNext pick up unrelated rows and break the ordering assertions below.
beforeAll(async () => {
  await db.delete(jobs);
});

test("claimNext claims the older pending job first, then the next, then null", async () => {
  const first = await repos.jobs.enqueue("submit_batch", { seq: 1 });
  createdIds.push(first.id);
  // Ensure distinct, strictly increasing run_at ordering between the two jobs.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await repos.jobs.enqueue("submit_batch", { seq: 2 });
  createdIds.push(second.id);

  const claimed1 = await repos.jobs.claimNext("w1");
  expect(claimed1).not.toBeNull();
  expect(claimed1?.id).toBe(first.id);
  expect(claimed1?.status).toBe("running");
  expect(claimed1?.attempts).toBe(1);

  const row1 = await fetchById(first.id);
  expect(row1?.lockedBy).toBe("w1");

  const claimed2 = await repos.jobs.claimNext("w2");
  expect(claimed2).not.toBeNull();
  expect(claimed2?.id).toBe(second.id);
  expect(claimed2?.id).not.toBe(claimed1?.id);
  expect(claimed2?.status).toBe("running");
  expect(claimed2?.attempts).toBe(1);

  const row2 = await fetchById(second.id);
  expect(row2?.lockedBy).toBe("w2");

  const claimed3 = await repos.jobs.claimNext("w3");
  expect(claimed3).toBeNull();
});

test("complete marks a job done", async () => {
  const job = await repos.jobs.enqueue("sync_invoices", { purpose: "complete" });
  createdIds.push(job.id);

  const claimed = await repos.jobs.claimNext("w-complete");
  expect(claimed?.id).toBe(job.id);

  await repos.jobs.complete(job.id);

  const dead = await repos.jobs.listDead();
  expect(dead.some((d) => d.id === job.id)).toBe(false);

  const row = await fetchById(job.id);
  expect(row?.status).toBe("done");
});

test("fail with a retry re-queues the job as pending with a future run_at", async () => {
  const job = await repos.jobs.enqueue("submit_batch", { purpose: "retry" });
  createdIds.push(job.id);

  const claimed = await repos.jobs.claimNext("w-retry");
  expect(claimed?.id).toBe(job.id);

  const beforeFail = new Date();
  await repos.jobs.fail(job.id, "transient error", 50);

  const row = await fetchById(job.id);
  expect(row?.status).toBe("pending");
  expect(row?.lastError).toBe("transient error");
  expect(row?.runAt.getTime()).toBeGreaterThan(beforeFail.getTime());

  // The job's run_at is in the future, so it should not be immediately claimable.
  const immediateClaim = await repos.jobs.claimNext("w-retry-2");
  expect(immediateClaim === null || immediateClaim.id !== job.id).toBe(true);
});

test("fail without a retry marks the job dead and listDead includes it", async () => {
  const job = await repos.jobs.enqueue("sync_invoices", { purpose: "dead" });
  createdIds.push(job.id);

  const claimed = await repos.jobs.claimNext("w-dead");
  expect(claimed?.id).toBe(job.id);

  await repos.jobs.fail(job.id, "permanent error", null);

  const row = await fetchById(job.id);
  expect(row?.status).toBe("failed");
  expect(row?.lastError).toBe("permanent error");

  const dead = await repos.jobs.listDead();
  expect(dead.some((d) => d.id === job.id)).toBe(true);
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(jobs).where(inArray(jobs.id, createdIds));
  }
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
