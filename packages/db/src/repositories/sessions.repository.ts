import { eq } from "drizzle-orm";
import { sessions } from "../schema";
import type { Executor, NewSessionRow, SessionRow, SessionsRepository } from "./types";

export class DrizzleSessionsRepository implements SessionsRepository {
  constructor(private readonly db: Executor) {}

  async create(input: NewSessionRow): Promise<SessionRow> {
    const [row] = await this.db.insert(sessions).values(input).returning();
    return row!;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async updateExpiry(id: string, expiresAt: Date): Promise<void> {
    await this.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  }
}
