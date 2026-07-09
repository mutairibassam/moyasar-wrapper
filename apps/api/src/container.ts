import { createRepositories, type Db, type Repositories } from "@moyasar-ops/db";
import type { Config } from "./config";
import { AuthService } from "./modules/auth/auth.service";
import { SlidingWindowRateLimiter } from "./modules/auth/rate-limiter";
import { BatchesService } from "./modules/batches/batches.service";
import { SettingsService } from "./modules/settings/settings.service";
import { UsersService } from "./modules/users/users.service";

export type Container = {
  config: Config;
  repos: Repositories;
  auth: AuthService;
  users: UsersService;
  batches: BatchesService;
  settings: SettingsService;
};

export function createContainer(db: Db, config: Config): Container {
  const repos = createRepositories(db);
  const limiter = new SlidingWindowRateLimiter(
    config.loginRateMax,
    config.loginRateWindowMinutes * 60_000,
  );
  const auth = new AuthService(repos, limiter, config.sessionTtlMinutes * 60_000);
  const users = new UsersService(repos);
  const batches = new BatchesService(repos);
  const settings = new SettingsService(repos, config.keyEncryptionKey);
  return { config, repos, auth, users, batches, settings };
}
