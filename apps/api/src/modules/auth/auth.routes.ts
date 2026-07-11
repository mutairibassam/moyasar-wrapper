import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { USER_ROLES } from "@moyasar-ops/shared";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { AuthnError, NotFoundError, ValidationError } from "../../errors";
import { requireAuth } from "../../middleware/rbac";
import { CSRF_COOKIE } from "../../middleware/csrf";
import { SESSION_COOKIE } from "../../middleware/session";

const OIDC_TX_COOKIE = "oidc_tx";

function setSessionCookies(c: Context<AppEnv>, token: string, secure: boolean, ttlMinutes: number) {
  const expires = new Date(Date.now() + ttlMinutes * 60_000);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", secure, path: "/", expires });
  const csrf = randomBytes(32).toString("base64url");
  setCookie(c, CSRF_COOKIE, csrf, { httpOnly: false, sameSite: "Lax", secure, path: "/", expires });
}

export function authRoutes() {
  const app = new Hono<AppEnv>();

  // Begin the OIDC handshake: stash state/nonce/PKCE in a short-lived cookie and
  // redirect to the IdP's authorize endpoint.
  app.get("/login", async (c) => {
    const container = c.get("container");
    const { url, state, nonce, codeVerifier } = await container.oidc.authorizationUrl();
    setCookie(c, OIDC_TX_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), {
      httpOnly: true,
      sameSite: "Lax",
      secure: container.config.cookieSecure,
      path: "/",
      maxAge: 600,
    });
    return c.redirect(url);
  });

  // IdP redirect target: validate the token, enforce the app-access group gate,
  // JIT-provision the user, and issue the session cookie.
  app.get("/callback", async (c) => {
    const container = c.get("container");
    const txRaw = getCookie(c, OIDC_TX_COOKIE);
    if (!txRaw) throw new AuthnError("Missing OIDC transaction");
    deleteCookie(c, OIDC_TX_COOKIE, { path: "/" });
    let tx: { state: string; nonce: string; codeVerifier: string };
    try {
      tx = JSON.parse(txRaw);
    } catch {
      throw new AuthnError("Malformed OIDC transaction");
    }

    const claims = await container.oidc.handleCallback({
      currentUrl: c.req.url,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      codeVerifier: tx.codeVerifier,
    });
    if (!claims.groups.includes(container.config.appAccessGroupId)) {
      throw new AuthnError("You do not have access to this application");
    }

    const user = await container.repos.users.upsertByEntraOid({
      entraOid: claims.subject,
      email: claims.email,
      displayName: claims.name,
      groupsSnapshot: claims.groups,
      defaultRole: "viewer",
    });
    const ip = clientIp(c.req.header("x-forwarded-for")) ?? clientIp(c.req.header("x-real-ip"));
    const { token } = await container.auth.issueSession(user, {
      ip,
      userAgent: c.req.header("user-agent") ?? null,
    });
    setSessionCookies(c, token, container.config.cookieSecure, container.config.sessionTtlMinutes);
    return c.redirect("/");
  });

  app.post("/logout", requireAuth, async (c) => {
    const container = c.get("container");
    const token = c.get("sessionToken");
    if (token) await container.auth.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    deleteCookie(c, CSRF_COOKIE, { path: "/" });
    return c.json({ endSessionUrl: container.oidc.endSessionUrl() });
  });

  // Dev-only session shim (never enabled in production). Mints a session for a
  // chosen email + role without an IdP round-trip.
  app.post("/dev-login", async (c) => {
    const container = c.get("container");
    if (!container.config.devLogin) throw new NotFoundError("Not found");
    const body = (await c.req.json().catch(() => null)) as
      | { email?: string; role?: string; displayName?: string }
      | null;
    if (!body?.email || !body?.role) throw new ValidationError("email and role are required");
    const role = USER_ROLES.find((r) => r === body.role);
    if (!role) throw new ValidationError(`role must be one of ${USER_ROLES.join(", ")}`);
    const user = await container.repos.users.upsertByEntraOid({
      entraOid: `dev:${body.email}`,
      email: body.email,
      displayName: body.displayName ?? body.email,
      groupsSnapshot: [],
      defaultRole: role,
    });
    const { token, user: pub } = await container.auth.issueSession(user, { ip: null, userAgent: "dev-login" });
    setSessionCookies(c, token, container.config.cookieSecure, container.config.sessionTtlMinutes);
    return c.json({ user: pub });
  });

  return app;
}
