import { afterAll, beforeAll, expect, test } from "bun:test";
import { appSettings, createDb, createRepositories, sessions } from "@moyasar-ops/db";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { createContainer } from "../../src/container";
import { hashPassword } from "../../src/modules/auth/password";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const config = {
  ...loadConfig({
    DATABASE_URL: url,
    KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  } as NodeJS.ProcessEnv),
  cookieSecure: false,
};
const app = createApp(createContainer(db, config));

const stamp = Date.now();
const adminEmail = `sf-admin-${stamp}@example.com`;
const viewerEmail = `sf-viewer-${stamp}@example.com`;
const ids: string[] = [];
const plaintextKey = `sk_test_${stamp}_supersecretmoyasarkey`;

async function seed(email: string, role: "admin" | "viewer") {
  const repos = createRepositories(db);
  const u = await repos.users.create({
    email,
    passwordHash: await hashPassword("a-strong-password"),
    displayName: role,
    role,
  });
  ids.push(u.id);
  return u.id;
}

function jar(setCookies: string[]) {
  const parts = setCookies.map((c) => c.split(";")[0]!);
  const csrf = parts.find((c) => c.startsWith("csrf_token="))!.split("=")[1]!;
  return { cookie: parts.join("; "), csrf };
}

async function login(email: string) {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "a-strong-password" }),
  });
  return jar(res.headers.getSetCookie());
}

beforeAll(async () => {
  await seed(adminEmail, "admin");
  await seed(viewerEmail, "viewer");
});

test("admin views masked settings, sets a key, switches mode; viewer is forbidden; plaintext key never leaks", async () => {
  const admin = await login(adminEmail);

  // 1. GET masked view
  const initial = await app.request("/api/v1/settings", {
    method: "GET",
    headers: { cookie: admin.cookie },
  });
  expect(initial.status).toBe(200);
  const initialText = await initial.text();
  expect(initialText).not.toContain(plaintextKey);
  const initialBody = JSON.parse(initialText);
  expect(initialBody.settings).toMatchObject({
    activeMode: expect.any(String),
    testKeySet: expect.any(Boolean),
    liveKeySet: expect.any(Boolean),
    updatedAt: expect.any(String),
  });
  expect(Object.keys(initialBody.settings).sort()).toEqual(
    ["activeMode", "liveKeySet", "testKeySet", "updatedAt"].sort(),
  );

  // 2. PUT /keys sets the test key
  const setKeyRes = await app.request("/api/v1/settings/keys", {
    method: "PUT",
    headers: { cookie: admin.cookie, "content-type": "application/json", "x-csrf-token": admin.csrf },
    body: JSON.stringify({ mode: "test", key: plaintextKey }),
  });
  expect(setKeyRes.status).toBe(200);
  const setKeyText = await setKeyRes.text();
  expect(setKeyText).not.toContain(plaintextKey);
  const setKeyBody = JSON.parse(setKeyText);
  expect(setKeyBody.settings.testKeySet).toBe(true);

  // Re-fetch to confirm persisted state
  const afterKey = await app.request("/api/v1/settings", {
    method: "GET",
    headers: { cookie: admin.cookie },
  });
  const afterKeyText = await afterKey.text();
  expect(afterKeyText).not.toContain(plaintextKey);
  const afterKeyBody = JSON.parse(afterKeyText);
  expect(afterKeyBody.settings.testKeySet).toBe(true);

  // 3. PUT /mode switches to live
  const setModeRes = await app.request("/api/v1/settings/mode", {
    method: "PUT",
    headers: { cookie: admin.cookie, "content-type": "application/json", "x-csrf-token": admin.csrf },
    body: JSON.stringify({ mode: "live" }),
  });
  expect(setModeRes.status).toBe(200);
  const setModeText = await setModeRes.text();
  expect(setModeText).not.toContain(plaintextKey);
  const setModeBody = JSON.parse(setModeText);
  expect(setModeBody.settings.activeMode).toBe("live");

  // 4. Viewer is forbidden
  const viewer = await login(viewerEmail);
  const forbidden = await app.request("/api/v1/settings", {
    method: "GET",
    headers: { cookie: viewer.cookie },
  });
  expect(forbidden.status).toBe(403);
  const forbiddenText = await forbidden.text();
  expect(forbiddenText).not.toContain(plaintextKey);
});

afterAll(async () => {
  // Reset activeMode back to "test" so the global singleton doesn't leak state across test runs.
  await db.update(appSettings).set({ activeMode: "test" }).where(eq(appSettings.id, 1));

  for (const id of ids) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    // audit_logs is append-only (trigger) — cannot delete; harmless test rows remain.
  }
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
