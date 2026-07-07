import { afterAll, beforeAll, expect, test } from "bun:test";
import { createDb, createRepositories, sessions } from "@moyasar-ops/db";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { createContainer } from "../../src/container";
import { hashPassword } from "../../src/modules/auth/password";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const config = { ...loadConfig({ DATABASE_URL: url } as NodeJS.ProcessEnv), cookieSecure: false };
const app = createApp(createContainer(db, config));

const adminEmail = `admin-${Date.now()}@example.com`;
let adminId = "";

beforeAll(async () => {
  const repos = createRepositories(db);
  const admin = await repos.users.create({
    email: adminEmail,
    passwordHash: await hashPassword("a-strong-password"),
    displayName: "Admin",
    role: "admin",
  });
  adminId = admin.id;
});

function cookieHeader(setCookies: string[]): { cookie: string; csrf: string } {
  const jar = setCookies.map((c) => c.split(";")[0]!);
  const csrf = jar.find((c) => c.startsWith("csrf_token="))!.split("=")[1]!;
  return { cookie: jar.join("; "), csrf };
}

test("login sets cookies, /me returns the user, protected route needs CSRF, logout clears session", async () => {
  const loginRes = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: "a-strong-password" }),
  });
  expect(loginRes.status).toBe(200);
  const { cookie, csrf } = cookieHeader(loginRes.headers.getSetCookie());

  const meRes = await app.request("/api/v1/me", { headers: { cookie } });
  expect(meRes.status).toBe(200);
  expect((await meRes.json()).user.email).toBe(adminEmail);

  // Creating a user without the CSRF header is rejected.
  const noCsrf = await app.request("/api/v1/users", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", password: "a-strong-password", displayName: "X", role: "maker" }),
  });
  expect(noCsrf.status).toBe(403);

  // With the CSRF header it succeeds.
  const created = await app.request("/api/v1/users", {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ email: `maker-${Date.now()}@example.com`, password: "a-strong-password", displayName: "Maker", role: "maker" }),
  });
  expect(created.status).toBe(201);

  const logoutRes = await app.request("/api/v1/auth/logout", {
    method: "POST",
    headers: { cookie, "x-csrf-token": csrf },
  });
  expect(logoutRes.status).toBe(204);

  const afterLogout = await app.request("/api/v1/me", { headers: { cookie } });
  expect(afterLogout.status).toBe(401);
});

test("a viewer cannot list users (403)", async () => {
  const repos = createRepositories(db);
  const viewerEmail = `viewer-${Date.now()}@example.com`;
  await repos.users.create({
    email: viewerEmail,
    passwordHash: await hashPassword("a-strong-password"),
    displayName: "Viewer",
    role: "viewer",
  });
  const login = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: viewerEmail, password: "a-strong-password" }),
  });
  const { cookie } = cookieHeader(login.headers.getSetCookie());
  const res = await app.request("/api/v1/users", { headers: { cookie } });
  expect(res.status).toBe(403);
});

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.userId, adminId));
  // audit_logs is append-only (DB trigger from the earlier audit migration),
  // so login/user.created rows referencing adminId can never be deleted, and
  // by extension neither can the admin user row (FK from audit_logs.actor_id).
  // Leave the seeded admin/maker/viewer test rows in place; they are harmless.
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
