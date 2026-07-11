import type { BatchView, PublicUser, UserRole } from "@/lib/api/types";

type Batch = Pick<BatchView, "createdBy" | "status">;
const has = (u: PublicUser | undefined, ...roles: UserRole[]) => !!u && roles.includes(u.role);

export const can = {
  createBatch: (u?: PublicUser) => has(u, "maker", "admin"),
  editBatch: (u?: PublicUser) => has(u, "maker", "admin"),
  cancelInvoice: (u?: PublicUser) => has(u, "approver", "admin"),
  refresh: (u?: PublicUser) => has(u, "maker", "approver", "admin"),
  admin: (u?: PublicUser) => has(u, "admin"),
  review: (u: PublicUser | undefined, b: Batch) =>
    has(u, "approver", "admin") && b.status === "pending_approval" && b.createdBy !== u!.id,
};
