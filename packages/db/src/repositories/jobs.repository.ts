import { and, count, eq, inArray, sql } from "drizzle-orm";
import { jobs } from "../schema";
import type { Executor, JobRow, JobsRepository } from "./types";

export class DrizzleJobsRepository implements JobsRepository {
  constructor(private readonly db: Executor) {}

  async enqueue(type: "submit_batch" | "sync_invoices", payload: Record<string, unknown>): Promise<JobRow> {
    const [row] = await this.db.insert(jobs).values({ type, payload }).returning();
    return row!;
  }

  async enqueueIn(type: "submit_batch" | "sync_invoices", payload: Record<string, unknown>, delayMs: number): Promise<JobRow> {
    const [row] = await this.db
      .insert(jobs)
      .values({ type, payload, runAt: sql`now() + (${delayMs} || ' milliseconds')::interval` })
      .returning();
    return row!;
  }

  async claimNext(workerId: string): Promise<JobRow | null> {
    const result = await this.db.execute(sql`
      UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending' AND run_at <= now()
        ORDER BY run_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `);
    const rows = result as unknown as JobRow[];
    return rows[0] ?? null;
  }

  async complete(id: string): Promise<void> {
    await this.db.update(jobs).set({ status: "done", lockedAt: null, lockedBy: null }).where(eq(jobs.id, id));
  }

  async fail(id: string, error: string, retryInMs: number | null): Promise<void> {
    if (retryInMs === null) {
      await this.db.update(jobs).set({ status: "failed", lastError: error, lockedAt: null, lockedBy: null }).where(eq(jobs.id, id));
      return;
    }
    await this.db
      .update(jobs)
      .set({
        status: "pending",
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        runAt: sql`now() + (${retryInMs} || ' milliseconds')::interval`,
      })
      .where(eq(jobs.id, id));
  }

  async listDead(): Promise<JobRow[]> {
    return this.db.select().from(jobs).where(eq(jobs.status, "failed"));
  }

  async hasPending(type: "submit_batch" | "sync_invoices"): Promise<boolean> {
    const [row] = await this.db
      .select({ value: count() })
      .from(jobs)
      .where(and(eq(jobs.type, type), inArray(jobs.status, ["pending", "running"])));
    return (row?.value ?? 0) > 0;
  }
}
