import type { UserRow } from "@moyasar-ops/db";
import type { UserRole } from "@moyasar-ops/shared";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
  };
}
