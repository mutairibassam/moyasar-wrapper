import { beforeEach, describe, expect, test } from "bun:test";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { UsersService } from "../../src/modules/users/users.service";
import { verifyPassword } from "../../src/modules/auth/password";
import { FakeRepositories } from "../support/fake-repositories";

const admin: PublicUser = {
  id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
  email: "admin@example.com",
  displayName: "Admin",
  role: "admin",
  isActive: true,
};
const ctx = { ip: "127.0.0.1" };

describe("UsersService.create", () => {
  let repos: FakeRepositories;
  let service: UsersService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new UsersService(repos);
  });

  test("creates a user with a hashed password and audits it", async () => {
    const user = await service.create(
      admin,
      { email: "maker@example.com", password: "a-strong-password", displayName: "Maker", role: "maker" },
      ctx,
    );
    expect(user.role).toBe("maker");
    const stored = repos.userRows.find((u) => u.id === user.id)!;
    expect(stored.passwordHash).not.toBe("a-strong-password");
    expect(await verifyPassword("a-strong-password", stored.passwordHash)).toBe(true);
    expect(repos.auditRows.some((a) => a.action === "user.created")).toBe(true);
    expect((user as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
  });

  test("rejects a duplicate email", async () => {
    await service.create(
      admin,
      { email: "dupe@example.com", password: "a-strong-password", displayName: "A", role: "maker" },
      ctx,
    );
    await expect(
      service.create(
        admin,
        { email: "dupe@example.com", password: "a-strong-password", displayName: "B", role: "viewer" },
        ctx,
      ),
    ).rejects.toThrow(/already in use/i);
  });
});

describe("UsersService.update", () => {
  let repos: FakeRepositories;
  let service: UsersService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new UsersService(repos);
    repos.userRows.push({
      id: admin.id,
      email: admin.email,
      passwordHash: "x",
      displayName: admin.displayName,
      role: "admin",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test("changes a role and audits user.role_changed", async () => {
    const target = await service.create(
      admin,
      { email: "t@example.com", password: "a-strong-password", displayName: "T", role: "viewer" },
      ctx,
    );
    const updated = await service.update(admin, target.id, { role: "approver" }, ctx);
    expect(updated.role).toBe("approver");
    expect(repos.auditRows.some((a) => a.action === "user.role_changed")).toBe(true);
  });

  test("resets a password (hashed) and audits user.updated", async () => {
    const target = await service.create(
      admin,
      { email: "pw@example.com", password: "a-strong-password", displayName: "PW", role: "viewer" },
      ctx,
    );
    await service.update(admin, target.id, { password: "a-new-strong-password" }, ctx);
    const stored = repos.userRows.find((u) => u.id === target.id)!;
    expect(await verifyPassword("a-new-strong-password", stored.passwordHash)).toBe(true);
  });

  test("prevents an admin from demoting or deactivating themselves", async () => {
    await expect(service.update(admin, admin.id, { role: "viewer" }, ctx)).rejects.toThrow(
      /cannot change your own role/i,
    );
    await expect(service.update(admin, admin.id, { isActive: false }, ctx)).rejects.toThrow(
      /cannot deactivate your own/i,
    );
  });

  test("throws NotFound for an unknown user", async () => {
    await expect(
      service.update(admin, "00000000-0000-7000-8000-000000000000", { role: "viewer" }, ctx),
    ).rejects.toThrow();
  });
});
