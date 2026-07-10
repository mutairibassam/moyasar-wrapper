import { beforeEach, describe, expect, test } from "bun:test";
import { JobRunner, type JobHandler } from "../../src/jobs/job-runner";
import { FakeRepositories } from "../support/fake-repositories";

describe("JobRunner", () => {
  let repos: FakeRepositories;

  beforeEach(() => {
    repos = new FakeRepositories();
  });

  test("handler resolves -> job marked done", async () => {
    const job = await repos.jobs.enqueue("submit_batch", { batchId: "b1" });
    const handlers: Record<string, JobHandler> = {
      submit_batch: async () => {},
    };
    const runner = new JobRunner(repos, handlers, { workerId: "w1", pollIntervalMs: 10, backoffMs: () => 0 });

    const ran = await runner.runOnce();

    expect(ran).toBe(true);
    const row = repos.jobRows.find((j) => j.id === job.id);
    expect(row?.status).toBe("done");
  });

  test("handler throws, attempts < maxAttempts -> re-queued pending with lastError set", async () => {
    const job = await repos.jobs.enqueue("sync_invoices", { batchId: "b2" });
    // Default fake row has maxAttempts: 5, so first attempt (attempts=1) < 5.
    const handlers: Record<string, JobHandler> = {
      sync_invoices: async () => {
        throw new Error("boom");
      },
    };
    const runner = new JobRunner(repos, handlers, { workerId: "w1", pollIntervalMs: 10, backoffMs: () => 0 });

    const ran = await runner.runOnce();

    expect(ran).toBe(true);
    const row = repos.jobRows.find((j) => j.id === job.id);
    expect(row?.status).toBe("pending");
    expect(row?.lastError).toBe("boom");
    expect(row?.attempts).toBe(1);
  });

  test("handler throws, attempts >= maxAttempts -> job dead, appears in listDead()", async () => {
    const job = await repos.jobs.enqueue("sync_invoices", { batchId: "b3" });
    // Force maxAttempts to 1 by mutating the fake's backing row directly.
    const row = repos.jobRows.find((j) => j.id === job.id);
    if (!row) throw new Error("seed row missing");
    row.maxAttempts = 1;

    const handlers: Record<string, JobHandler> = {
      sync_invoices: async () => {
        throw new Error("fatal");
      },
    };
    const runner = new JobRunner(repos, handlers, { workerId: "w1", pollIntervalMs: 10, backoffMs: () => 0 });

    const ran = await runner.runOnce();

    expect(ran).toBe(true);
    const dead = await repos.jobs.listDead();
    expect(dead.some((j) => j.id === job.id)).toBe(true);
    const updated = repos.jobRows.find((j) => j.id === job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.lastError).toBe("fatal");
  });

  test("runOnce returns false when no claimable job", async () => {
    const runner = new JobRunner(repos, {}, { workerId: "w1", pollIntervalMs: 10, backoffMs: () => 0 });

    const ran = await runner.runOnce();

    expect(ran).toBe(false);
  });

  test("start() processes enqueued jobs via the poll loop and stop() settles cleanly", async () => {
    const job = await repos.jobs.enqueue("submit_batch", { batchId: "b5" });
    const handlers: Record<string, JobHandler> = {
      submit_batch: async () => {},
    };
    const runner = new JobRunner(repos, handlers, { workerId: "w1", pollIntervalMs: 5, backoffMs: () => 0 });

    runner.start();
    runner.start(); // double-start should be a no-op guard
    await new Promise((resolve) => setTimeout(resolve, 30));
    await runner.stop();

    const row = repos.jobRows.find((j) => j.id === job.id);
    expect(row?.status).toBe("done");
  });

  test("unknown job type -> failed (dead) with 'No handler' error, runOnce returns true", async () => {
    const job = await repos.jobs.enqueue("submit_batch", { batchId: "b4" });
    const runner = new JobRunner(repos, {}, { workerId: "w1", pollIntervalMs: 10, backoffMs: () => 0 });

    const ran = await runner.runOnce();

    expect(ran).toBe(true);
    const row = repos.jobRows.find((j) => j.id === job.id);
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toMatch(/no handler/i);
    const dead = await repos.jobs.listDead();
    expect(dead.some((j) => j.id === job.id)).toBe(true);
  });
});
