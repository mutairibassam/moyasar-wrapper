import { beforeEach, describe, expect, test } from "bun:test";
import { BatchesService } from "../../src/modules/batches/batches.service";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { FakeRepositories } from "../support/fake-repositories";

const maker: PublicUser = { id: "maker-1", email: "m@x.co", displayName: "M", role: "maker", isActive: true };
const approver: PublicUser = { id: "appr-1", email: "a@x.co", displayName: "A", role: "approver", isActive: true };
const ctx = { ip: "127.0.0.1" };

async function pendingApprovalBatch(service: BatchesService): Promise<string> {
  const b = await service.create(maker, { name: "March", currency: "SAR" }, ctx);
  await service.replaceItems(maker, b.id, [{ amount: 14999, currency: "SAR", description: "A" }], ctx);
  await service.submitForApproval(maker, b.id, ctx);
  return b.id;
}

describe("concurrent approval (TOCTOU guard)", () => {
  let repos: FakeRepositories;
  let service: BatchesService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new BatchesService(repos);
  });

  test("a conditional update on batches.repository only succeeds while status still matches", async () => {
    const batchId = await pendingApprovalBatch(service);

    // First conditional update: batch is still "pending_approval", so this succeeds.
    const first = await repos.batches.update(batchId, { status: "approved" }, "pending_approval");
    expect(first).not.toBeNull();
    expect(first?.status).toBe("approved");

    // Second conditional update: status is now "approved", not "pending_approval" — guard rejects it.
    const second = await repos.batches.update(batchId, { status: "approved" }, "pending_approval");
    expect(second).toBeNull();
  });

  test("two concurrent approvers racing approve(): only one wins, the other gets StateTransitionError", async () => {
    const batchId = await pendingApprovalBatch(service);
    const otherApprover: PublicUser = { ...approver, id: "appr-2" };

    const results = await Promise.allSettled([
      service.approve(approver, batchId, ctx),
      service.approve(otherApprover, batchId, ctx),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser is rejected with a StateTransitionError. With the synchronous
    // FakeRepositories the pre-transaction status check fires first ("...it is
    // approved"); against a real interleaving DB the conditional-update backstop
    // fires ("no longer pending approval"). Both are the correct rejection and
    // both mention "pending".
    const reason = (rejected[0] as PromiseRejectedResult).reason as { name?: string; message?: string };
    expect(reason?.name).toBe("StateTransitionError");
    expect(reason?.message).toMatch(/pending/i);

    const finalView = await service.get(approver, batchId);
    expect(finalView.status).toBe("approved");
  });
});
