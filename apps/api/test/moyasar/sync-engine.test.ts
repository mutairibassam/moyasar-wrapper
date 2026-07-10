import { beforeEach, describe, expect, test } from "bun:test";
import { SyncEngine, type SyncClient } from "../../src/modules/moyasar/sync-engine";
import type { MoyasarInvoice } from "../../src/modules/moyasar/moyasar-types";
import { FakeRepositories } from "../support/fake-repositories";

const invoice = (platformItemId: string, status: string): MoyasarInvoice => ({
  id: `inv_${platformItemId}`,
  status,
  amount: 100,
  currency: "SAR",
  description: "x",
  url: null,
  metadata: { platform_item_id: platformItemId },
});

function stubClient(byBatch: Record<string, MoyasarInvoice[]>): SyncClient {
  return {
    listByBatch: async (id: string) => ({ invoices: byBatch[id] ?? [], nextPage: null }),
  };
}

async function seedOpenItem(
  repos: FakeRepositories,
  batchId: string,
  rowNumber: number,
): Promise<string> {
  const [row] = await repos.items.insertMany([
    { batchId, rowNumber, amount: 100, currency: "SAR", description: `row-${rowNumber}` },
  ]);
  await repos.items.recordSubmitted(row!.id, { id: `inv_${row!.id}`, url: null, status: "initiated" });
  return row!.id;
}

describe("SyncEngine.syncOpenInvoices", () => {
  let repos: FakeRepositories;
  beforeEach(() => {
    repos = new FakeRepositories();
  });

  test("detects a paid invoice, leaves others, and reports counts", async () => {
    const a = await seedOpenItem(repos, "batch-1", 1);
    const b = await seedOpenItem(repos, "batch-1", 2);
    const engine = new SyncEngine({
      repos,
      client: stubClient({ "batch-1": [invoice(a, "paid"), invoice(b, "initiated")] }),
    });

    const result = await engine.syncOpenInvoices();

    expect(result).toEqual({ scanned: 2, updated: 1 });
    expect(repos.itemRows.find((i) => i.id === a)!.moyasarStatus).toBe("paid");
    expect(repos.itemRows.find((i) => i.id === b)!.moyasarStatus).toBe("initiated");
    // the paid item drops out of the open set
    expect((await repos.items.listOpenSubmitted()).map((i) => i.id)).toEqual([b]);
  });

  test("writes through expired and canceled statuses", async () => {
    const a = await seedOpenItem(repos, "batch-1", 1);
    const b = await seedOpenItem(repos, "batch-1", 2);
    const engine = new SyncEngine({
      repos,
      client: stubClient({ "batch-1": [invoice(a, "expired"), invoice(b, "canceled")] }),
    });

    const result = await engine.syncOpenInvoices();

    expect(result.updated).toBe(2);
    expect(repos.itemRows.find((i) => i.id === a)!.moyasarStatus).toBe("expired");
    expect(repos.itemRows.find((i) => i.id === b)!.moyasarStatus).toBe("canceled");
  });

  test("no-op when the upstream status is unchanged", async () => {
    const a = await seedOpenItem(repos, "batch-1", 1);
    const engine = new SyncEngine({ repos, client: stubClient({ "batch-1": [invoice(a, "initiated")] }) });

    const result = await engine.syncOpenInvoices();

    expect(result).toEqual({ scanned: 1, updated: 0 });
  });

  test("never changes the item's submission `status` column", async () => {
    const a = await seedOpenItem(repos, "batch-1", 1);
    expect(repos.itemRows.find((i) => i.id === a)!.status).toBe("submitted");
    const engine = new SyncEngine({ repos, client: stubClient({ "batch-1": [invoice(a, "paid")] }) });

    await engine.syncOpenInvoices();

    const item = repos.itemRows.find((i) => i.id === a)!;
    expect(item.status).toBe("submitted"); // submission lifecycle untouched
    expect(item.moyasarStatus).toBe("paid"); // only the Moyasar status changed
    expect(item.lastSyncedAt).not.toBeNull();
  });

  test("ignores an unrecognized upstream status without writing or throwing", async () => {
    const a = await seedOpenItem(repos, "batch-1", 1);
    const engine = new SyncEngine({ repos, client: stubClient({ "batch-1": [invoice(a, "weird_value")] }) });

    const result = await engine.syncOpenInvoices();

    expect(result).toEqual({ scanned: 1, updated: 0 });
    expect(repos.itemRows.find((i) => i.id === a)!.moyasarStatus).toBe("initiated");
  });
});

describe("SyncEngine pagination", () => {
  test("traverses multiple pages then terminates on a null nextPage", async () => {
    const repos = new FakeRepositories();
    const a = await seedOpenItem(repos, "batch-1", 1);
    const b = await seedOpenItem(repos, "batch-1", 2);
    // page 1 returns A (nextPage 2), page 2 returns B (nextPage null)
    const pages: Record<number, { invoices: MoyasarInvoice[]; nextPage: number | null }> = {
      1: { invoices: [invoice(a, "paid")], nextPage: 2 },
      2: { invoices: [invoice(b, "expired")], nextPage: null },
    };
    const engine = new SyncEngine({
      repos,
      client: { listByBatch: async (_id: string, page: number) => pages[page]! },
    });

    const result = await engine.syncBatch("batch-1");

    expect(result).toEqual({ scanned: 2, updated: 2 });
    expect(repos.itemRows.find((i) => i.id === a)!.moyasarStatus).toBe("paid");
    expect(repos.itemRows.find((i) => i.id === b)!.moyasarStatus).toBe("expired");
  });

  test("throws when nextPage does not strictly advance (guards an infinite loop)", async () => {
    const repos = new FakeRepositories();
    await seedOpenItem(repos, "batch-1", 1);
    // nextPage 1 never advances past page 1 → must throw rather than loop forever
    const engine = new SyncEngine({
      repos,
      client: { listByBatch: async () => ({ invoices: [], nextPage: 1 }) },
    });

    await expect(engine.syncBatch("batch-1")).rejects.toThrow(/pagination/i);
  });
});

describe("SyncEngine.syncBatch", () => {
  test("only polls and updates the given batch's items", async () => {
    const repos = new FakeRepositories();
    const a = await seedOpenItem(repos, "batch-1", 1);
    const b = await seedOpenItem(repos, "batch-2", 1);
    const engine = new SyncEngine({
      repos,
      client: stubClient({ "batch-1": [invoice(a, "paid")], "batch-2": [invoice(b, "paid")] }),
    });

    const result = await engine.syncBatch("batch-1");

    expect(result).toEqual({ scanned: 1, updated: 1 });
    expect(repos.itemRows.find((i) => i.id === a)!.moyasarStatus).toBe("paid");
    expect(repos.itemRows.find((i) => i.id === b)!.moyasarStatus).toBe("initiated"); // batch-2 untouched
  });
});
