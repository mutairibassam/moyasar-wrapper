import { describe, expect, test } from "bun:test";
import type { UserRow } from "@moyasar-ops/db";
import { AuthService } from "../../src/modules/auth/auth.service";
import { hashToken } from "../../src/modules/auth/tokens";
import { FakeRepositories } from "../support/fake-repositories";

const TTL = 720 * 60 * 1000;
const ctx = { ip: "127.0.0.1", userAgent: "test" };

function userRow(over: Partial<UserRow> = {}): UserRow {
  return {
    id: "11111111-1111-7111-8111-111111111111",
    email: "user@example.com",
    entraOid: "oid-1",
    passwordHash: null,
    displayName: "User",
    role: "viewer",
    groupsSnapshot: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("AuthService.issueSession", () => {
  test("creates a session + login audit and returns a token", async () => {
    const repos = new FakeRepositories();
    const service = new AuthService(repos, TTL);
    const { token, user } = await service.issueSession(userRow(), ctx);
    expect(token).toBeTruthy();
    expect(user.email).toBe("user@example.com");
    expect(user.role).toBe("viewer");
    expect(repos.sessionRows).toHaveLength(1);
    expect(repos.sessionRows[0]!.tokenHash).toBe(hashToken(token));
    expect(repos.auditRows.some((a) => a.action === "user.login")).toBe(true);
  });
});

describe("AuthService.resolveSession / logout", () => {
  test("resolves a valid session and reports the slide target; logout deletes it", async () => {
    const repos = new FakeRepositories();
    const service = new AuthService(repos, TTL);
    repos.userRows.push(userRow());
    const { token } = await service.issueSession(userRow(), ctx);
    const resolved = await service.resolveSession(token);
    expect(resolved?.user.email).toBe("user@example.com");
    expect(resolved?.slideTo.getTime()).toBeGreaterThan(Date.now());

    await service.logout(token);
    expect(await service.resolveSession(token)).toBeNull();
  });

  test("returns null for an expired session", async () => {
    const repos = new FakeRepositories();
    const service = new AuthService(repos, TTL);
    repos.userRows.push(userRow());
    const { token } = await service.issueSession(userRow(), ctx);
    repos.sessionRows[0]!.expiresAt = new Date(Date.now() - 1000);
    expect(await service.resolveSession(token)).toBeNull();
  });
});
