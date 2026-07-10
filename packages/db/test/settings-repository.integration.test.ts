import { afterAll, expect, test } from "bun:test";
import { createDb, createRepositories } from "../src";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const repos = createRepositories(db);

test("settings.get() returns/creates the singleton and update persists", async () => {
  const s = await repos.settings.get();
  expect(s.id).toBe(1);
  const updated = await repos.settings.update({ activeMode: "live" });
  expect(updated.activeMode).toBe("live");
  // restore for other tests
  await repos.settings.update({ activeMode: "test" });
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
