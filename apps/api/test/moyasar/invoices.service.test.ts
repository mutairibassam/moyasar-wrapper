import { beforeEach, describe, expect, test } from "bun:test";
import type { ItemRow } from "@moyasar-ops/db";
import { AuthzError, NotFoundError, StateTransitionError } from "../../src/errors";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { InvoicesService, type InvoiceOpsClient } from "../../src/modules/moyasar/invoices.service";
import type { MoyasarInvoice } from "../../src/modules/moyasar/moyasar-types";
import { FakeRepositories } from "../support/fake-repositories";

function makeUser(role: PublicUser["role"], id = "user-1"): PublicUser {
  return { id, email: `${id}@example.com`, displayName: id, role, isActive: true };
}

function invoice(id: string, status: string, platformItemId?: string): MoyasarInvoice {
  return {
    id,
    status,
    amount: 100,
    currency: "SAR",
    description: "x",
    url: null,
    metadata: platformItemId ? { platform_item_id: platformItemId } : null,
  };
}

class FakeInvoiceOpsClient implements InvoiceOpsClient {
  cancelCalls: string[] = [];
  byBatch: Record<string, MoyasarInvoice[]> = {};
  cancelResult: MoyasarInvoice = invoice("inv_x", "canceled");

  async listByBatch(id: string, _page: number): Promise<{ invoices: MoyasarInvoice[]; nextPage: number | null }> {
    return { invoices: this.byBatch[id] ?? [], nextPage: null };
  }

  async cancel(id: string): Promise<MoyasarInvoice> {
    this.cancelCalls.push(id);
    return this.cancelResult;
  }

  async fetchInvoice(id: string): Promise<MoyasarInvoice> {
    return invoice(id, "initiated");
  }
}

async function seedInvoiceItem(
  repos: FakeRepositories,
  batchId: string,
  rowNumber: number,
  moyasarStatus: string,
): Promise<{ itemId: string; moyasarInvoiceId: string }> {
  const [row] = await repos.items.insertMany([
    { batchId, rowNumber, amount: 100, currency: "SAR", description: `row-${rowNumber}` },
  ]);
  const moyasarInvoiceId = `inv_${row!.id}`;
  await repos.items.recordSubmitted(row!.id, { id: moyasarInvoiceId, url: null, status: "initiated" });
  if (moyasarStatus !== "initiated") {
    await repos.items.syncStatus(row!.id, moyasarStatus as NonNullable<ItemRow["moyasarStatus"]>);
  }
  return { itemId: row!.id, moyasarInvoiceId };
}

describe("InvoicesService.list", () => {
  let repos: FakeRepositories;
  let client: FakeInvoiceOpsClient;
  let service: InvoicesService;

  beforeEach(() => {
    repos = new FakeRepositories();
    client = new FakeInvoiceOpsClient();
    service = new InvoicesService({ repos, makeClient: async () => client });
  });

  test("maps rows to ItemView (with amountFormatted) and paginates", async () => {
    await seedInvoiceItem(repos, "batch-1", 1, "initiated");
    await seedInvoiceItem(repos, "batch-1", 2, "initiated");
    await seedInvoiceItem(repos, "batch-1", 3, "initiated");

    const result = await service.list({ page: 1, perPage: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.amountFormatted).toBeDefined();
    expect(result.items[0]!.moyasarInvoiceId).toBeTruthy();
    expect(result.meta).toEqual({ page: 1, perPage: 2, total: 3, totalPages: 2 });
  });

  test("filters by moyasarStatus", async () => {
    await seedInvoiceItem(repos, "batch-1", 1, "initiated");
    const paid = await seedInvoiceItem(repos, "batch-1", 2, "paid");

    const result = await service.list({ page: 1, perPage: 10, moyasarStatus: "paid" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.moyasarInvoiceId).toBe(paid.moyasarInvoiceId);
    expect(result.meta.total).toBe(1);
  });
});

describe("InvoicesService.cancel", () => {
  let repos: FakeRepositories;
  let client: FakeInvoiceOpsClient;
  let service: InvoicesService;

  beforeEach(() => {
    repos = new FakeRepositories();
    client = new FakeInvoiceOpsClient();
    service = new InvoicesService({ repos, makeClient: async () => client });
  });

  test("happy path: approver cancels an initiated invoice", async () => {
    const { moyasarInvoiceId } = await seedInvoiceItem(repos, "batch-1", 1, "initiated");
    const actor = makeUser("approver");

    const view = await service.cancel(actor, moyasarInvoiceId, { ip: "1.2.3.4" });

    expect(client.cancelCalls).toEqual([moyasarInvoiceId]);
    expect(view.moyasarStatus).toBe("canceled");

    const item = repos.itemRows.find((i) => i.moyasarInvoiceId === moyasarInvoiceId)!;
    expect(item.moyasarStatus).toBe("canceled");

    const auditEntry = repos.auditRows.find((a) => a.action === "invoice.canceled");
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.entityId).toBe(moyasarInvoiceId);
    expect(auditEntry!.actorId).toBe(actor.id);
  });

  test("admin can also cancel", async () => {
    const { moyasarInvoiceId } = await seedInvoiceItem(repos, "batch-1", 1, "initiated");
    const actor = makeUser("admin");

    const view = await service.cancel(actor, moyasarInvoiceId, { ip: null });

    expect(view.moyasarStatus).toBe("canceled");
  });

  test("refuses a non-initiated item without calling the client", async () => {
    const { moyasarInvoiceId } = await seedInvoiceItem(repos, "batch-1", 1, "paid");
    const actor = makeUser("approver");

    await expect(service.cancel(actor, moyasarInvoiceId, { ip: null })).rejects.toThrow(StateTransitionError);
    expect(client.cancelCalls).toEqual([]);
  });

  test("refuses a maker with AuthzError, without calling the client", async () => {
    const { moyasarInvoiceId } = await seedInvoiceItem(repos, "batch-1", 1, "initiated");
    const actor = makeUser("maker");

    await expect(service.cancel(actor, moyasarInvoiceId, { ip: null })).rejects.toThrow(AuthzError);
    expect(client.cancelCalls).toEqual([]);
  });

  test("unknown moyasarInvoiceId throws NotFoundError", async () => {
    const actor = makeUser("approver");

    await expect(service.cancel(actor, "inv_does_not_exist", { ip: null })).rejects.toThrow(NotFoundError);
    expect(client.cancelCalls).toEqual([]);
  });
});

describe("InvoicesService.refreshBatch", () => {
  let repos: FakeRepositories;
  let client: FakeInvoiceOpsClient;
  let service: InvoicesService;

  beforeEach(() => {
    repos = new FakeRepositories();
    client = new FakeInvoiceOpsClient();
    service = new InvoicesService({ repos, makeClient: async () => client });
  });

  test("delegates to syncBatch and returns updated count", async () => {
    const { itemId, moyasarInvoiceId } = await seedInvoiceItem(repos, "batch-1", 1, "initiated");
    client.byBatch["batch-1"] = [invoice(moyasarInvoiceId, "paid", itemId)];

    const result = await service.refreshBatch(makeUser("maker"), "batch-1");

    expect(result).toEqual({ updated: 1 });
    expect(repos.itemRows.find((i) => i.id === itemId)!.moyasarStatus).toBe("paid");
  });

  test("viewer role is refused with AuthzError", async () => {
    await expect(service.refreshBatch(makeUser("viewer"), "batch-1")).rejects.toThrow(AuthzError);
  });
});
