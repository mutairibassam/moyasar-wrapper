import { eq } from "drizzle-orm";
import { users } from "../schema";
import type { Executor, NewUserRow, UserRow, UsersRepository } from "./types";

export class DrizzleUsersRepository implements UsersRepository {
  constructor(private readonly db: Executor) {}

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  }

  async list(): Promise<UserRow[]> {
    return this.db.select().from(users).orderBy(users.createdAt);
  }

  async create(input: NewUserRow): Promise<UserRow> {
    const [row] = await this.db.insert(users).values(input).returning();
    return row!;
  }

  async update(id: string, patch: Partial<NewUserRow>): Promise<UserRow | null> {
    const [row] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }
}
