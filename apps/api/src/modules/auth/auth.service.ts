import type { Repositories } from "@moyasar-ops/db";
import { AuthnError } from "../../errors";
import { verifyPassword } from "./password";
import { type PublicUser, toPublicUser } from "./public-user";
import type { SlidingWindowRateLimiter } from "./rate-limiter";
import { generateSessionToken, hashToken } from "./tokens";

export type LoginContext = { ip: string | null; userAgent: string | null };

export class AuthService {
  constructor(
    private readonly repos: Repositories,
    private readonly rateLimiter: SlidingWindowRateLimiter,
    private readonly sessionTtlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(
    input: { email: string; password: string },
    ctx: LoginContext,
  ): Promise<{ token: string; user: PublicUser }> {
    const email = input.email.toLowerCase();
    const accountKey = `login:${email}`;
    const ipKey = `ip:${ctx.ip ?? "unknown"}`;

    if (!this.rateLimiter.check(accountKey) || !this.rateLimiter.check(ipKey)) {
      throw new AuthnError("Too many attempts. Please try again later.");
    }

    const user = await this.repos.users.findByEmail(email);
    const ok = user && user.isActive && (await verifyPassword(input.password, user.passwordHash));

    if (!ok || !user) {
      this.rateLimiter.hit(accountKey);
      this.rateLimiter.hit(ipKey);
      throw new AuthnError("Invalid email or password");
    }

    this.rateLimiter.reset(accountKey);
    const token = generateSessionToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(this.now().getTime() + this.sessionTtlMs);

    await this.repos.transaction(async (r) => {
      await r.sessions.create({
        userId: user.id,
        tokenHash,
        expiresAt,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await r.audit.record({
        actorId: user.id,
        action: "user.login",
        entityType: "user",
        entityId: user.id,
        ip: ctx.ip,
      });
    });

    return { token, user: toPublicUser(user) };
  }

  async logout(token: string): Promise<void> {
    await this.repos.sessions.deleteByTokenHash(hashToken(token));
  }

  async resolveSession(
    token: string,
  ): Promise<{ user: PublicUser; slideTo: Date } | null> {
    const session = await this.repos.sessions.findByTokenHash(hashToken(token));
    if (!session) return null;
    if (session.expiresAt.getTime() <= this.now().getTime()) return null;
    const user = await this.repos.users.findById(session.userId);
    if (!user || !user.isActive) return null;
    return {
      user: toPublicUser(user),
      slideTo: new Date(this.now().getTime() + this.sessionTtlMs),
    };
  }
}
