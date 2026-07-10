import { createRepositories, type Db, type Repositories } from "@moyasar-ops/db";
import type { Config } from "./config";
import { JobRunner, type JobHandler } from "./jobs/job-runner";
import { AuthService } from "./modules/auth/auth.service";
import { SlidingWindowRateLimiter } from "./modules/auth/rate-limiter";
import { BatchesService } from "./modules/batches/batches.service";
import { MoyasarClient } from "./modules/moyasar/moyasar-client";
import { SubmissionEngine } from "./modules/moyasar/submission-engine";
import { SettingsService } from "./modules/settings/settings.service";
import { UsersService } from "./modules/users/users.service";

export type Container = {
  config: Config;
  repos: Repositories;
  auth: AuthService;
  users: UsersService;
  batches: BatchesService;
  settings: SettingsService;
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

  const submitBatchHandler: JobHandler = async (payload) => {
    const { key } = await settings.activeSecretKey();
    const client = new MoyasarClient({ baseUrl: config.moyasarBaseUrl, secretKey: key, fetchImpl: moyasarFetch });
    const engine = new SubmissionEngine({ repos, client });
    await engine.submitBatch(payload.batchId as string);
  };
  const runner = new JobRunner(
    repos,
    { submit_batch: submitBatchHandler },
    { workerId: "api-1", pollIntervalMs: config.jobPollIntervalMs },
  );

  return { config, repos, auth, users, batches, settings, runner };
}
