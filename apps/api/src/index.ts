import { createDb } from "@moyasar-ops/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createContainer } from "./container";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const container = createContainer(db, config);
const app = createApp(container);

container.runner.start();

if (!(await container.repos.jobs.hasPending("sync_invoices"))) {
  await container.repos.jobs.enqueueIn("sync_invoices", {}, 0);
}

async function shutdown(): Promise<void> {
  await container.runner.stop();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

console.log(`api listening on :${config.port}`);

export default { port: config.port, fetch: app.fetch };
