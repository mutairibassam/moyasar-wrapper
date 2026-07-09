import type { Db } from "../client";
import { DrizzleAuditRepository } from "./audit.repository";
import { DrizzleBatchesRepository } from "./batches.repository";
import { DrizzleItemsRepository } from "./items.repository";
import { DrizzleSessionsRepository } from "./sessions.repository";
import { DrizzleSettingsRepository } from "./settings.repository";
import { DrizzleUsersRepository } from "./users.repository";
import type { Executor, Repositories } from "./types";

export * from "./types";

function build(executor: Executor, root: Db): Repositories {
  return {
    users: new DrizzleUsersRepository(executor),
    sessions: new DrizzleSessionsRepository(executor),
    audit: new DrizzleAuditRepository(executor),
    batches: new DrizzleBatchesRepository(executor),
    items: new DrizzleItemsRepository(executor),
    settings: new DrizzleSettingsRepository(executor),
    transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
      if (executor === root) {
        return root.transaction((tx) => fn(build(tx, root)));
      }
      // Already inside a transaction — reuse the same executor.
      return fn(this);
    },
  };
}

export function createRepositories(db: Db): Repositories {
  return build(db, db);
}
