import type { Repositories } from "@moyasar-ops/db";
import type { CreateUserInput, UpdateUserInput } from "@moyasar-ops/shared";
import { AuthzError, NotFoundError, ValidationError } from "../../errors";
import { hashPassword } from "../auth/password";
import { type PublicUser, toPublicUser } from "../auth/public-user";

export class UsersService {
  constructor(private readonly repos: Repositories) {}

  async list(): Promise<PublicUser[]> {
    const rows = await this.repos.users.list();
    return rows.map(toPublicUser);
  }

  async create(
    actor: PublicUser,
    input: CreateUserInput,
    ctx: { ip: string | null },
  ): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    if (await this.repos.users.findByEmail(email)) {
      throw new ValidationError("Email already in use", { field: "email" });
    }
    const passwordHash = await hashPassword(input.password);

    return this.repos.transaction(async (r) => {
      const row = await r.users.create({
        email,
        passwordHash,
        displayName: input.displayName,
        role: input.role,
      });
      const user = toPublicUser(row);
      await r.audit.record({
        actorId: actor.id,
        action: "user.created",
        entityType: "user",
        entityId: row.id,
        after: user,
        ip: ctx.ip,
      });
      return user;
    });
  }

  async update(
    actor: PublicUser,
    id: string,
    patch: UpdateUserInput,
    ctx: { ip: string | null },
  ): Promise<PublicUser> {
    const existing = await this.repos.users.findById(id);
    if (!existing) throw new NotFoundError("User not found");

    if (actor.id === id && patch.role !== undefined && patch.role !== existing.role) {
      throw new AuthzError("You cannot change your own role");
    }
    if (actor.id === id && patch.isActive === false) {
      throw new AuthzError("You cannot deactivate your own account");
    }

    const dbPatch: Record<string, unknown> = {};
    if (patch.displayName !== undefined) dbPatch.displayName = patch.displayName;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    if (patch.isActive !== undefined) dbPatch.isActive = patch.isActive;
    if (patch.password !== undefined) dbPatch.passwordHash = await hashPassword(patch.password);

    const before = toPublicUser(existing);
    const roleChanged = patch.role !== undefined && patch.role !== existing.role;

    return this.repos.transaction(async (r) => {
      const row = await r.users.update(id, dbPatch);
      if (!row) throw new NotFoundError("User not found");
      const after = toPublicUser(row);
      await r.audit.record({
        actorId: actor.id,
        action: roleChanged ? "user.role_changed" : "user.updated",
        entityType: "user",
        entityId: id,
        before,
        after,
        ip: ctx.ip,
      });
      return after;
    });
  }
}
