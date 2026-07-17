import { expect, test } from "bun:test";
import { loginAs, makeTestApp } from "../support/auth";

async function startTx(app: ReturnType<typeof makeTestApp>["app"]) {
  const res = await app.request("/api/v1/auth/login", { redirect: "manual" });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.startsWith("oidc_tx="))!;
}

test("callback creates a session when the user is in the app-access group", async () => {
  const { app, oidc } = makeTestApp();
  oidc.nextClaims = {
    subject: `oid-${Date.now()}`,
    email: `u${Date.now()}@x.com`,
    name: "U",
    groups: ["grp-app"],
  };
  const tx = await startTx(app);
  const cb = await app.request("/api/v1/auth/callback?code=x&state=s", {
    headers: { cookie: tx },
    redirect: "manual",
  });
  expect(cb.status).toBe(302);
  expect(cb.headers.getSetCookie().some((c) => c.startsWith("session="))).toBe(true);
});

test("callback rejects a user not in the app-access group", async () => {
  const { app, oidc } = makeTestApp();
  oidc.nextClaims = {
    subject: `oid-${Date.now()}`,
    email: `u${Date.now()}@x.com`,
    name: "U",
    groups: ["other"],
  };
  const tx = await startTx(app);
  const cb = await app.request("/api/v1/auth/callback?code=x&state=s", {
    headers: { cookie: tx },
    redirect: "manual",
  });
  expect(cb.status).toBe(401);
});

test("dev-login mints a working session; /me returns the user", async () => {
  const { app } = makeTestApp();
  const email = `dev${Date.now()}@x.com`;
  const s = await loginAs(app, { email, role: "admin" });
  const me = await app.request("/api/v1/me", { headers: { cookie: s.cookie } });
  expect(me.status).toBe(200);
  expect((await me.json()).user.email).toBe(email);
});

test("dev-login is disabled when DEV_LOGIN is off", async () => {
  const { app } = makeTestApp({ devLogin: false });
  const res = await app.request("/api/v1/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "x@x.com", role: "admin" }),
  });
  expect(res.status).toBe(404);
});
