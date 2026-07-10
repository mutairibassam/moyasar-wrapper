import { createRepositories, type Db, type Repositories } from "@moyasar-ops/db";
import type { Config } from "./config";
import { JobRunner, type JobHandler } from "./jobs/job-runner";
import { AuthService } from "./modules/auth/auth.service";
import { SlidingWindowRateLimiter } from "./modules/auth/rate-limiter";
import { BatchesService } from "./modules/batches/batches.service";
import { InvoicesService } from "./modules/moyasar/invoices.service";
import { MoyasarClient } from "./modules/moyasar/moyasar-client";
import { SubmissionEngine } from "./modules/moyasar/submission-engine";
import { SyncEngine } from "./modules/moyasar/sync-engine";
import { SettingsService } from "./modules/settings/settings.service";
import { UsersService } from "./modules/users/users.service";

export type Container = {
  config: Config;
  repos: Repositories;
  auth: AuthService;
  users: UsersService;
  batches: BatchesService;
  settings: SettingsService;
  invoices: InvoicesService;
  runner: JobRunner;
};

export function createContainer(db: Db, config: Config, moyasarFetch?: typeof fetch): Container {
  const repos = createRepositories(db);
  const limiter = new SlidingWindowRateLimiter(
    config.loginRateMax,
    config.loginRateWindowMinutes * 60_000,
  );
  const auth = new AuthService(repos, limiter, config.sessionTtlMinutes * 60_000);
  const users = new UsersService(repos);
  const batches = new BatchesService(repos);
  const settings = new SettingsService(repos, config.keyEncryptionKey);

  const makeMoyasarClient = async (): Promise<MoyasarClient> =>
    new MoyasarClient({
      baseUrl: config.moyasarBaseUrl,
      secretKey: (await settings.activeSecretKey()).key,
      fetchImpl: moyasarFetch,
    });

  const invoices = new InvoicesService({ repos, makeClient: makeMoyasarClient });

  const submitBatchHandler: JobHandler = async (payload) => {
    const client = await makeMoyasarClient();
    const engine = new SubmissionEngine({ repos, client });
    await engine.submitBatch(payload.batchId as string);
  };
  // Self-rescheduling recurring job: poll open invoices, then enqueue the next run.
  // Assumes a SINGLE runner instance (MVP Compose deployment). Running multiple API
  // instances would double-enqueue this chain; multi-instance needs a scheduler lock
  // (e.g. a unique-pending constraint) — see Plan 6 / horizontal-scale notes.
  const syncInvoicesHandler: JobHandler = async () => {
    const client = await makeMoyasarClient();
    await new SyncEngine({ repos, client }).syncOpenInvoices();
    await repos.jobs.enqueueIn("sync_invoices", {}, config.syncIntervalMs);
  };
  const runner = new JobRunner(
    repos,
    { submit_batch: submitBatchHandler, sync_invoices: syncInvoicesHandler },
    { workerId: "api-1", pollIntervalMs: config.jobPollIntervalMs },
  );

  return { config, repos, auth, users, batches, settings, invoices, runner };
}
