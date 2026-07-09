import { eq } from "drizzle-orm";
import { appSettings } from "../schema";
import type { Executor, NewSettingsRow, SettingsRepository, SettingsRow } from "./types";

export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Executor) {}

  async get(): Promise<SettingsRow> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    if (row) return row;
    const [created] = await this.db
      .insert(appSettings)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await this.db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    return existing!;
  }

  async update(patch: Partial<NewSettingsRow>): Promise<SettingsRow> {
    await this.get(); // ensure the singleton exists
    const [row] = await this.db
      .update(appSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(appSettings.id, 1))
      .returning();
    return row!;
  }
}
