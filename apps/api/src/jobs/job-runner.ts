import type { Repositories } from "@moyasar-ops/db";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface JobRunnerOptions {
  workerId: string;
  pollIntervalMs: number;
  backoffMs?: (attempts: number) => number;
}

const defaultBackoffMs = (attempts: number): number => Math.min(1000 * 2 ** attempts, 60_000);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class JobRunner {
  private readonly backoffMs: (attempts: number) => number;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly handlers: Record<string, JobHandler>,
    private readonly opts: JobRunnerOptions,
  ) {
    this.backoffMs = opts.backoffMs ?? defaultBackoffMs;
  }

  async runOnce(): Promise<boolean> {
    const job = await this.repos.jobs.claimNext(this.opts.workerId);
    if (!job) return false;

    console.log(
      JSON.stringify({ event: "job.claimed", jobId: job.id, jobType: job.type, workerId: this.opts.workerId }),
    );

    const handler = this.handlers[job.type];
    if (!handler) {
      const error = `No handler for job type ${job.type}`;
      await this.repos.jobs.fail(job.id, error, null);
      console.log(JSON.stringify({ event: "job.no-handler", jobId: job.id, jobType: job.type, error }));
      return true;
    }

    try {
      await handler(job.payload as Record<string, unknown>);
      await this.repos.jobs.complete(job.id);
      console.log(JSON.stringify({ event: "job.done", jobId: job.id, jobType: job.type }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const retry = job.attempts >= job.maxAttempts ? null : this.backoffMs(job.attempts);
      await this.repos.jobs.fail(job.id, msg, retry);
      console.log(
        JSON.stringify({
          event: retry === null ? "job.dead" : "job.failed",
          jobId: job.id,
          jobType: job.type,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          error: msg,
        }),
      );
    }

    return true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const ran = await this.runOnce();
      if (!ran) {
        await sleep(this.opts.pollIntervalMs);
      }
    }
  }
}
