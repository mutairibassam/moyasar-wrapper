import { beforeEach, describe, expect, test } from "bun:test";
import { FakeRepositories } from "../support/fake-repositories";

// Proves the self-reschedule CONTRACT that Task 6 wires into the real
// sync_invoices handler + container, without needing the real container.
describe("recurring sync_invoices self-reschedule", () => {
  let repos: FakeRepositories;
  let stubSync: { syncOpenInvoices: () => Promise<{ scanned: number; updated: number }> };

  beforeEach(() => {
    repos = new FakeRepositories();
    stubSync = { syncOpenInvoices: async () => ({ scanned: 0, updated: 0 }) };
  });

  test("running the handler once enqueues exactly one follow-up sync_invoices job with a future run_at", async () => {
    const handler = async () => {
      await stubSync.syncOpenInvoices();
      await repos.jobs.enqueueIn("sync_invoices", {}, 300_000);
    };

    const before = new Date();
    await handler();

    const syncJobs = repos.jobRows.filter((j) => j.type === "sync_invoices");
    expect(syncJobs).toHaveLength(1);
    expect(syncJobs[0]!.runAt.getTime()).toBeGreaterThan(before.getTime());
    expect(syncJobs[0]!.status).toBe("pending");
  });
});
