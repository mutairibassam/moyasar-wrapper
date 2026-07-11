import { createDb, createRepositories, type Db } from "@moyasar-ops/db";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { createContainer, type Container } from "../../src/container";
import type { OidcClient } from "../../src/modules/auth/oidc/oidc-client";
import { FakeOidcClient } from "./oidc";

const DEFAULT_URL = "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";

export function testConfig(devLogin = true) {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;
  return {
    ...loadConfig({
      DATABASE_URL: url,
      KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      OIDC_ISSUER_URL: "https://idp.test/realms/dev",
      OIDC_CLIENT_ID: "app",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_REDIRECT_URI: "http://localhost/api/v1/auth/callback",
      APP_ACCESS_GROUP_ID: "grp-app",
      DEV_LOGIN: devLogin ? "true" : "false",
    } as NodeJS.ProcessEnv),
    cookieSecure: false,
  };
}

/** Build an app around an existing db (reuses the connection pool for per-test containers). */
export function makeApp<T extends OidcClient = FakeOidcClient>(
  db: Db,
  opts: { moyasarFetch?: typeof fetch; oidc?: T; devLogin?: boolean } = {},
) {
  const oidc = (opts.oidc ?? new FakeOidcClient()) as T;
  const container: Container = createContainer(db, testConfig(opts.devLogin ?? true), oidc, opts.moyasarFetch);
  const app = createApp(container);
  return { app, oidc, container };
}

/** Build a self-contained app + db for the common case. */
export function makeTestApp<T extends OidcClient = FakeOidcClient>(opts: { moyasarFetch?: typeof fetch; oidc?: T; devLogin?: boolean } = {}) {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;
  const db = createDb(url);
  const { app, oidc, container } = makeApp(db, opts);
  return { app, oidc, container, db, repos: createRepositories(db) };
}

function jar(setCookies: string[]) {
  const parts = setCookies.map((c) => c.split(";")[0]!);
  const csrf = parts.find((c) => c.startsWith("csrf_token="))!.split("=")[1]!;
  return { cookie: parts.join("; "), csrf };
}

/**
 * Authenticate via the dev-login shim, which JIT-provisions the user and returns
 * it. Replaces the old seed()+password-login() pair: one call creates the user and
 * the session, and returns the user id for createdBy/ownership assertions.
 */
export async function loginAs(
  app: ReturnType<typeof createApp>,
  input: { email: string; role: "admin" | "maker" | "approver" | "viewer" },
): Promise<{ cookie: string; csrf: string; userId: string }> {
  const res = await app.request("/api/v1/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status !== 200) throw new Error(`dev-login failed: ${res.status}`);
  const { cookie, csrf } = jar(res.headers.getSetCookie());
  const body = (await res.json()) as { user: { id: string } };
  return { cookie, csrf, userId: body.user.id };
}
