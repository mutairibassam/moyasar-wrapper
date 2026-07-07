import { beforeEach, describe, expect, test } from "bun:test";
import { BatchesService } from "../../src/modules/batches/batches.service";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { FakeRepositories } from "../support/fake-repositories";

const maker: PublicUser = { id: "maker-1", email: "m@x.co", displayName: "M", role: "maker", isActive: true };
const approver: PublicUser = { id: "appr-1", email: "a@x.co", displayName: "A", role: "approver", isActive: true };
const ctx = { ip: "127.0.0.1" };

async function draftWithValidItems(service: BatchesService): Promise<string> {
  const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
  await service.replaceItems(maker, b.id, [{ amount: 14999, currency: "SAR", description: "A" }], ctx);
  return b.id;
}

describe("submitForApproval", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("moves a valid draft to pending_approval and audits", async () => {
    const id = await draftWithValidItems(service);
    const view = await service.submitForApproval(maker, id, ctx);
    expect(view.status).toBe("pending_approval");
    expect(repos.auditRows.some((a) => a.action === "batch.submitted_for_approval")).toBe(true);
  });

  test("refuses an empty batch", async () => {
    const b = await service.create(maker, { name: "Empty", currency: "SAR" }, ctx);
    await expect(service.submitForApproval(maker, b.id, ctx)).rejects.toThrow(/at least one/i);
  });

  test("refuses a batch containing invalid rows", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await service.replaceItems(
      maker,
      b.id,
      [{ amount: 14999, currency: "SAR", description: "ok" }, { amount: 1, currency: "SAR", description: "bad" }],
      ctx,
    );
    await expect(service.submitForApproval(maker, b.id, ctx)).rejects.toThrow(/invalid/i);
  });
});

describe("approve / reject (maker-checker)", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("an approver (not the creator) can approve a pending batch", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    const view = await service.approve(approver, id, ctx);
    expect(view.status).toBe("approved");
    expect(view.approvedBy).toBe(approver.id);
    expect(view.mode).not.toBeNull(); // mode snapshotted
    expect(repos.auditRows.some((a) => a.action === "batch.approved")).toBe(true);
  });

  test("the creator cannot approve their own batch, even as admin", async () => {
    const adminMaker: PublicUser = { ...maker, role: "admin" };
    const s = new BatchesService(repos);
    const b = await s.create(adminMaker, { name: "Self", currency: "SAR" }, ctx);
    await s.replaceItems(adminMaker, b.id, [{ amount: 100, currency: "SAR", description: "A" }], ctx);
    await s.submitForApproval(adminMaker, b.id, ctx);
    await expect(s.approve(adminMaker, b.id, ctx)).rejects.toThrow(/your own/i);
  });

  test("a maker cannot approve (role guard)", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    const otherMaker: PublicUser = { ...maker, id: "maker-2" };
    await expect(service.approve(otherMaker, id, ctx)).rejects.toThrow(/permission/i);
  });

  test("approve only works from pending_approval", async () => {
    const id = await draftWithValidItems(service);
    await expect(service.approve(approver, id, ctx)).rejects.toThrow(/pending/i);
  });

  test("reject requires a comment and returns the batch to rejected (editable)", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    const view = await service.reject(approver, id, "Wrong amounts", ctx);
    expect(view.status).toBe("rejected");
    expect(view.rejectionComment).toBe("Wrong amounts");
    expect(repos.auditRows.some((a) => a.action === "batch.rejected")).toBe(true);

    // A rejected batch is editable again.
    const edited = await service.replaceItems(maker, id, [{ amount: 500, currency: "SAR", description: "fixed" }], ctx);
    expect(edited.status).toBe("draft");
    expect(edited.rejectionComment).toBeNull();
  });

  test("an approved batch is immutable (cannot be edited)", async () => {
    const id = await draftWithValidItems(service);
    await service.submitForApproval(maker, id, ctx);
    await service.approve(approver, id, ctx);
    await expect(
      service.replaceItems(maker, id, [{ amount: 100, currency: "SAR", description: "x" }], ctx),
    ).rejects.toThrow(/cannot be edited/i);
  });
});

describe("cloneFailed", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("clones invalid rows into a fresh draft batch and audits", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await service.replaceItems(
      maker,
      b.id,
      [{ amount: 14999, currency: "SAR", description: "ok" }, { amount: 1, currency: "SAR", description: "bad" }],
      ctx,
    );

    const clone = await service.cloneFailed(maker, b.id, ctx);

    expect(clone.id).not.toBe(b.id);
    expect(clone.status).toBe("draft");
    expect(clone.name).toMatch(/retry/i);
    expect(clone.items.length).toBe(1);
    expect(clone.items[0]?.status).toBe("draft");
    expect(repos.auditRows.some((a) => a.action === "batch.cloned_from_failed")).toBe(true);
  });

  test("refuses to clone a batch with no invalid or failed rows", async () => {
    const id = await draftWithValidItems(service);
    await expect(service.cloneFailed(maker, id, ctx)).rejects.toThrow();
  });

  test("a viewer cannot clone (role guard)", async () => {
    const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
    await service.replaceItems(maker, b.id, [{ amount: 1, currency: "SAR", description: "bad" }], ctx);
    const viewer: PublicUser = { ...maker, id: "v", role: "viewer" };
    await expect(service.cloneFailed(viewer, b.id, ctx)).rejects.toThrow();
  });

  test("cloning an unknown batch id throws NotFound", async () => {
    await expect(service.cloneFailed(maker, "unknown-id", ctx)).rejects.toThrow();
  });
});
