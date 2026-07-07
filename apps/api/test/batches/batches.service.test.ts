import { beforeEach, describe, expect, test } from "bun:test";
import { BatchesService } from "../../src/modules/batches/batches.service";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { FakeRepositories } from "../support/fake-repositories";

const maker: PublicUser = {
  id: "11111111-1111-7111-8111-111111111111",
  email: "maker@example.com",
  displayName: "Maker",
  role: "maker",
  isActive: true,
};
const ctx = { ip: "127.0.0.1" };

describe("BatchesService.create + intake", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("creates a draft batch and audits it", async () => {
    const view = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    expect(view.status).toBe("draft");
    expect(view.currency).toBe("SAR");
    expect(repos.auditRows.some((a) => a.action === "batch.created")).toBe(true);
  });

  test("replaceItems stores valid rows, recomputes totals, and audits", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    const view = await service.replaceItems(
      maker,
      b.id,
      [
        { amount: 14999, currency: "SAR", description: "A" },
        { amount: 100, currency: "SAR", description: "B" },
      ],
      ctx,
    );
    expect(view.itemCount).toBe(2);
    expect(view.totalAmount).toBe(15099);
    expect(view.items.every((i) => i.status === "valid")).toBe(true);
    expect(repos.auditRows.some((a) => a.action === "batch.items_replaced")).toBe(true);
  });

  test("replaceItems replaces (not appends) prior items and renumbers rows", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await service.replaceItems(maker, b.id, [{ amount: 100, currency: "SAR", description: "old" }], ctx);
    const view = await service.replaceItems(
      maker,
      b.id,
      [
        { amount: 200, currency: "SAR", description: "new1" },
        { amount: 300, currency: "SAR", description: "new2" },
      ],
      ctx,
    );
    expect(view.items.map((i) => i.rowNumber)).toEqual([1, 2]);
    expect(view.items.map((i) => i.description)).toEqual(["new1", "new2"]);
  });

  test("ingestCsv marks an invalid row and excludes it from the total", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    const csv = "amount,description,expired_at,success_url,back_url,callback_url\n149.99,Good,,,,\n0.99,TooSmall,,,,";
    const view = await service.ingestCsv(maker, b.id, csv, ctx);
    expect(view.itemCount).toBe(2);
    const invalid = view.items.find((i) => i.status === "invalid");
    expect(invalid?.validationErrors?.amount).toBeDefined();
    expect(view.totalAmount).toBe(14999); // only the valid row counts
  });

  test("ingestCsv rejects a file with a bad header (ValidationError)", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await expect(service.ingestCsv(maker, b.id, "nonsense\nrow", ctx)).rejects.toThrow(/column/i);
  });

  test("get returns the batch with items; unknown id throws NotFound", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    const got = await service.get(maker, b.id);
    expect(got.id).toBe(b.id);
    await expect(service.get(maker, "00000000-0000-7000-8000-000000000000")).rejects.toThrow();
  });

  test("a viewer cannot create a batch (AuthzError from the service guard)", async () => {
    const viewer: PublicUser = { ...maker, id: "v", role: "viewer" };
    await expect(service.create(viewer, { name: "x", currency: "SAR" }, ctx)).rejects.toThrow();
  });
});
