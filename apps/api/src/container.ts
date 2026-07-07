import { createRepositories, type Db, type Repositories } from "@moyasar-ops/db";
import type { Config } from "./config";
import { AuthService } from "./modules/auth/auth.service";
import { SlidingWindowRateLimiter } from "./modules/auth/rate-limiter";
import { UsersService } from "./modules/users/users.service";

export type Container = {
  config: Config;
  repos: Repositories;
  auth: AuthService;
  users: UsersService;
};

export function createContainer(db: Db, config: Config): Container {
  const repos = createRepositories(db);
  const limiter = new SlidingWindowRateLimiter(
    config.loginRateMax,
    config.loginRateWindowMinutes * 60_000,
  );
  const auth = new AuthService(repos, limiter, config.sessionTtlMinutes * 60_000);
  const users = new UsersService(repos);
  return { config, repos, auth, users };
}
