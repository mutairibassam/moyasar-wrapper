import { describe, expect, test } from "bun:test";
import { SubmissionEngine, type SubmissionClient } from "../../src/modules/moyasar/submission-engine";
import type { BulkInvoiceInput, MoyasarInvoice } from "../../src/modules/moyasar/moyasar-types";
import { MoyasarApiError } from "../../src/errors";
import { FakeRepositories } from "../support/fake-repositories";

function makeInvoice(input: BulkInvoiceInput, overrides: Partial<MoyasarInvoice> = {}): MoyasarInvoice {
  return {
    id: `inv_${input.metadata.platform_item_id}`,
    status: "initiated",
    amount: input.amount,
    currency: input.currency,
    description: input.description,
    url: `https://pay/${input.metadata.platform_item_id}`,
    metadata: input.metadata,
    ...overrides,
  };
}

class FakeClient implements SubmissionClient {
  createBulkCalls: BulkInvoiceInput[][] = [];
  preExisting: MoyasarInvoice[] = [];
  onCreateBulk?: (invoices: BulkInvoiceInput[]) => MoyasarInvoice[] | never;

  async createBulk(invoices: BulkInvoiceInput[]): Promise<MoyasarInvoice[]> {
    this.createBulkCalls.push(invoices);
    if (this.onCreateBulk) return this.onCreateBulk(invoices);
    return invoices.map((i) => makeInvoice(i));
  }

  async listByBatch(_id: string, page: number): Promise<{ invoices: MoyasarInvoice[]; nextPage: number | null }> {
    if (page !== 1) return { invoices: [], nextPage: null };
    return { invoices: this.preExisting, nextPage: null };
  }
}

async function seedBatch(
  repos: FakeRepositories,
  opts: { status?: "approved" | "submitting" | "submitted"; itemCount: number },
) {
  const batch = await repos.batches.create({
    name: "Test batch",
    currency: "SAR",
    source: "manual",
    createdBy: (await repos.users.create({
      email: "maker@example.com",
      passwordHash: "x",
      displayName: "Maker",
      role: "maker",
    })).id,
  });
  await repos.batches.update(batch.id, { status: opts.status ?? "approved" });
  const rows = Array.from({ length: opts.itemCount }, (_, idx) => ({
    batchId: batch.id,
    rowNumber: idx + 1,
    amount: 1000 + idx,
    currency: "SAR",
    description: `Invoice ${idx + 1}`,
    status: "valid" as const,
    validationErrors: null,
  }));
  const items = await repos.items.insertMany(rows);
  return { batch: (await repos.batches.findById(batch.id))!, items };
}

describe("SubmissionEngine.submitBatch", () => {
  test("happy path: all items submitted, batch submitted", async () => {
    const repos = new FakeRepositories();
    const { batch, items } = await seedBatch(repos, { itemCount: 3 });
    const client = new FakeClient();
    const engine = new SubmissionEngine({ repos, client });

    await engine.submitBatch(batch.id);

    const finalItems = await repos.items.listByBatch(batch.id);
    expect(finalItems).toHaveLength(3);
    for (const item of finalItems) {
      expect(item.status).toBe("submitted");
      expect(item.moyasarInvoiceId).toBe(`inv_${item.id}`);
    }
    const finalBatch = await repos.batches.findById(batch.id);
    expect(finalBatch!.status).toBe("submitted");
    expect(finalBatch!.completedAt).not.toBeNull();

    const submittedAudit = repos.auditRows.find((a) => a.action === "batch.submitted");
    expect(submittedAudit).toBeDefined();
    const startedAudit = repos.auditRows.find((a) => a.action === "batch.submission_started");
    expect(startedAudit).toBeDefined();

    expect(items).toHaveLength(3);
  });

  test("chunking: 120 valid items -> 3 createBulk calls of 50/50/20", async () => {
    const repos = new FakeRepositories();
    const { batch } = await seedBatch(repos, { itemCount: 120 });
    const client = new FakeClient();
    const engine = new SubmissionEngine({ repos, client });

    await engine.submitBatch(batch.id);

    expect(client.createBulkCalls).toHaveLength(3);
    expect(client.createBulkCalls[0]).toHaveLength(50);
    expect(client.createBulkCalls[1]).toHaveLength(50);
    expect(client.createBulkCalls[2]).toHaveLength(20);

    const finalItems = await repos.items.listByBatch(batch.id);
    expect(finalItems.every((i) => i.status === "submitted")).toBe(true);
    const finalBatch = await repos.batches.findById(batch.id);
    expect(finalBatch!.status).toBe("submitted");
  });

  test("definitive 4xx: chunk items fail, batch partially_failed", async () => {
    const repos = new FakeRepositories();
    const { batch } = await seedBatch(repos, { itemCount: 3 });
    const client = new FakeClient();
    client.onCreateBulk = () => {
      throw new MoyasarApiError("Rejected: bad amount", { message: "bad amount" }, false);
    };
    const engine = new SubmissionEngine({ repos, client });

    await engine.submitBatch(batch.id);

    const finalItems = await repos.items.listByBatch(batch.id);
    expect(finalItems.every((i) => i.status === "failed")).toBe(true);
    for (const item of finalItems) {
      expect(item.validationErrors).toEqual({ submission: ["Rejected: bad amount"] });
    }
    const finalBatch = await repos.batches.findById(batch.id);
    expect(finalBatch!.status).toBe("partially_failed");
    const audit = repos.auditRows.find((a) => a.action === "batch.partially_failed");
    expect(audit).toBeDefined();
  });

  test("crash recovery / idempotency: pre-existing invoice heals via reconciliation, is not re-sent", async () => {
    const repos = new FakeRepositories();
    const { batch, items } = await seedBatch(repos, { itemCount: 2 });
    const [itemA, itemB] = items;
    const client = new FakeClient();
    client.preExisting = [
      {
        id: "inv_existing_a",
        status: "initiated",
        amount: itemA!.amount,
        currency: itemA!.currency,
        description: itemA!.description,
        url: "https://pay/existing_a",
        metadata: { platform_item_id: itemA!.id, platform_batch_id: batch.id },
      },
    ];
    const engine = new SubmissionEngine({ repos, client });

    await engine.submitBatch(batch.id);

    // createBulk must only ever have been called with item B's input
    const allSentItemIds = client.createBulkCalls.flat().map((i) => i.metadata.platform_item_id);
    expect(allSentItemIds).not.toContain(itemA!.id);
    expect(allSentItemIds).toContain(itemB!.id);

    const finalA = (await repos.items.listByBatch(batch.id)).find((i) => i.id === itemA!.id)!;
    const finalB = (await repos.items.listByBatch(batch.id)).find((i) => i.id === itemB!.id)!;
    expect(finalA.status).toBe("submitted");
    expect(finalA.moyasarInvoiceId).toBe("inv_existing_a");
    expect(finalB.status).toBe("submitted");
    expect(finalB.moyasarInvoiceId).toBe(`inv_${itemB!.id}`);

    const finalBatch = await repos.batches.findById(batch.id);
    expect(finalBatch!.status).toBe("submitted");
  });

  test("ambiguous error mid-run: submitBatch rethrows; items remain submitting; batch stays submitting", async () => {
    const repos = new FakeRepositories();
    const { batch } = await seedBatch(repos, { itemCount: 2 });
    const client = new FakeClient();
    client.onCreateBulk = () => {
      throw new MoyasarApiError("network timeout", undefined, true);
    };
    const engine = new SubmissionEngine({ repos, client });

    await expect(engine.submitBatch(batch.id)).rejects.toThrow(MoyasarApiError);

    const finalItems = await repos.items.listByBatch(batch.id);
    expect(finalItems.every((i) => i.status === "submitting")).toBe(true);
    expect(finalItems.every((i) => i.status !== "failed")).toBe(true);

    const finalBatch = await repos.batches.findById(batch.id);
    expect(finalBatch!.status).toBe("submitting");
  });

  test("reserved metadata keys win over hostile user-supplied metadata", async () => {
    const repos = new FakeRepositories();
    const { batch } = await seedBatch(repos, { itemCount: 0 });
    const [item] = await repos.items.insertMany([
      {
        batchId: batch.id,
        rowNumber: 1,
        amount: 1500,
        currency: "SAR",
        description: "Hostile metadata item",
        status: "valid" as const,
        validationErrors: null,
        metadata: { platform_item_id: "USER-SUPPLIED-BOGUS", order_ref: "PO-1" },
      },
    ]);
    const client = new FakeClient();
    const engine = new SubmissionEngine({ repos, client });

    await engine.submitBatch(batch.id);

    expect(client.createBulkCalls).toHaveLength(1);
    const sent = client.createBulkCalls[0]![0]!;
    expect(sent.metadata.platform_item_id).toBe(item!.id);
    expect(sent.metadata.platform_item_id).not.toBe("USER-SUPPLIED-BOGUS");
    expect(sent.metadata.platform_batch_id).toBe(batch.id);
    expect(sent.metadata.order_ref).toBe("PO-1");
  });

  test("idempotent no-op: already-submitted batch returns without calling the client", async () => {
    const repos = new FakeRepositories();
    const { batch } = await seedBatch(repos, { itemCount: 1, status: "submitted" });
    const client = new FakeClient();
    const engine = new SubmissionEngine({ repos, client });

    await engine.submitBatch(batch.id);

    expect(client.createBulkCalls).toHaveLength(0);
  });
});
