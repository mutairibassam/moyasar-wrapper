import { beforeEach, describe, expect, test } from "bun:test";
import { AuthService } from "../../src/modules/auth/auth.service";
import { hashPassword } from "../../src/modules/auth/password";
import { hashToken } from "../../src/modules/auth/tokens";
import { SlidingWindowRateLimiter } from "../../src/modules/auth/rate-limiter";
import { FakeRepositories } from "../support/fake-repositories";

const TTL = 720 * 60 * 1000;
const ctx = { ip: "127.0.0.1", userAgent: "test" };

async function seedUser(repos: FakeRepositories, over: Partial<{ isActive: boolean }> = {}) {
  repos.userRows.push({
    id: "11111111-1111-7111-8111-111111111111",
    email: "user@example.com",
    passwordHash: await hashPassword("a-strong-password"),
    displayName: "User",
    role: "maker",
    isActive: over.isActive ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("AuthService.login", () => {
  let repos: FakeRepositories;
  let service: AuthService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new AuthService(repos, new SlidingWindowRateLimiter(5, 60_000), TTL);
  });

  test("issues a session and writes a login audit row on success", async () => {
    await seedUser(repos);
    const { token, user } = await service.login(
      { email: "user@example.com", password: "a-strong-password" },
      ctx,
    );
    expect(user.email).toBe("user@example.com");
    expect(repos.sessionRows).toHaveLength(1);
    expect(repos.sessionRows[0]!.tokenHash).toBe(hashToken(token));
    expect(repos.auditRows.some((a) => a.action === "user.login")).toBe(true);
  });

  test("rejects a wrong password without creating a session", async () => {
    await seedUser(repos);
    await expect(
      service.login({ email: "user@example.com", password: "wrong-password!!" }, ctx),
    ).rejects.toThrow();
    expect(repos.sessionRows).toHaveLength(0);
  });

  test("rejects an unknown email and an inactive user identically", async () => {
    await expect(
      service.login({ email: "ghost@example.com", password: "whatever12345" }, ctx),
    ).rejects.toThrow("Invalid email or password");
    repos.userRows = [];
    await seedUser(repos, { isActive: false });
    await expect(
      service.login({ email: "user@example.com", password: "a-strong-password" }, ctx),
    ).rejects.toThrow("Invalid email or password");
  });

  test("blocks after too many attempts on the same account", async () => {
    await seedUser(repos);
    service = new AuthService(repos, new SlidingWindowRateLimiter(2, 60_000), TTL);
    await service.login({ email: "user@example.com", password: "bad1-aaaaaaaa" }, ctx).catch(() => {});
    await service.login({ email: "user@example.com", password: "bad2-aaaaaaaa" }, ctx).catch(() => {});
    await expect(
      service.login({ email: "user@example.com", password: "a-strong-password" }, ctx),
    ).rejects.toThrow(/too many/i);
  });
});

describe("AuthService.resolveSession / logout", () => {
  test("resolves a valid session and reports the slide target; logout deletes it", async () => {
    const repos = new FakeRepositories();
    const service = new AuthService(repos, new SlidingWindowRateLimiter(5, 60_000), TTL);
    await seedUser(repos);
    const { token } = await service.login(
      { email: "user@example.com", password: "a-strong-password" },
      ctx,
    );
    const resolved = await service.resolveSession(token);
    expect(resolved?.user.email).toBe("user@example.com");
    expect(resolved?.slideTo.getTime()).toBeGreaterThan(Date.now());

    await service.logout(token);
    expect(await service.resolveSession(token)).toBeNull();
  });

  test("returns null for an expired session", async () => {
    const repos = new FakeRepositories();
    const service = new AuthService(repos, new SlidingWindowRateLimiter(5, 60_000), TTL);
    await seedUser(repos);
    const { token } = await service.login(
      { email: "user@example.com", password: "a-strong-password" },
      ctx,
    );
    repos.sessionRows[0]!.expiresAt = new Date(Date.now() - 1000);
    expect(await service.resolveSession(token)).toBeNull();
  });
});
