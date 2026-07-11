import { describe, expect, test } from "vitest";
import { can } from "./permissions";

const u = (id: string, role: string) => ({ id, role }) as never;

describe("permissions", () => {
  test("maker can create/edit but not review", () => {
    expect(can.createBatch(u("m", "maker"))).toBe(true);
    expect(
      can.review(u("m", "maker"), { createdBy: "x", status: "pending_approval" } as never),
    ).toBe(false);
  });
  test("approver cannot review own batch (no self-approval)", () => {
    expect(
      can.review(u("a", "approver"), { createdBy: "a", status: "pending_approval" } as never),
    ).toBe(false);
    expect(
      can.review(u("a", "approver"), { createdBy: "b", status: "pending_approval" } as never),
    ).toBe(true);
  });
  test("review only in pending_approval", () => {
    expect(can.review(u("a", "approver"), { createdBy: "b", status: "draft" } as never)).toBe(
      false,
    );
  });
  test("undefined user denies everything", () => {
    expect(can.createBatch(undefined)).toBe(false);
    expect(can.admin(undefined)).toBe(false);
  });
});
