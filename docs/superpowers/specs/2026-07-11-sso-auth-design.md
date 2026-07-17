# Design — Microsoft SSO Authentication (Sub-project A)

**Date:** 2026-07-11
**Status:** Approved (design) — pending implementation plan
**Scope:** Replace native password authentication with Microsoft Entra ID (Azure AD)
single-sign-on, using the API as a backend-for-frontend that issues the existing
session cookie. Authentication and session only — authorization/roles and the
approval workflow are separate sub-projects.

---

## Context

This is the first of four sub-projects that rework the platform's identity and
approval model. The full decomposition:

| # | Sub-project | Replaces / touches |
|---|---|---|
| **A** | Microsoft SSO auth (this spec) | Plan 2 native auth |
| **B** | Group-based authorization + 3-role model (admin / approver / user) | Plan 2/3 RBAC, `permissions.ts` |
| **C** | Two-stage, line-manager-routed approval workflow | Plan 3 maker-checker, batch state machine |
| **D** | UI updates reflecting A–C | Plan 6a web |

Sub-project A delivers working Microsoft sign-in, session issuance, an app-access
gate, just-in-time user provisioning, and a green test suite. It deliberately does
**not** change roles or the approval workflow.

### Decisions locked during brainstorming

1. **API-as-BFF.** The Bun/Hono API runs the OIDC handshake and issues the same
   httpOnly `session` + `csrf_token` cookies used today. The Next.js frontend and
   its route guard are essentially unchanged. (Rejected: Auth.js in Next, MSAL SPA
   tokens — both discard the existing cookie/CSRF model.)
2. **Config-driven OIDC.** The OIDC client reads its issuer/discovery URL, client
   credentials, and claim-name mappings from environment — nothing about Entra is
   hardcoded. Consequence: the only difference between local dev and production is
   **environment variables, not code**. (Rejected as auth transports: LDAP —
   reintroduces app-held passwords, needs Entra Domain Services / on-prem AD, and
   loses SSO/MFA/Conditional Access; SCIM — is provisioning/sync, not
   authentication. See "Future options".)
3. **Two-layer dev/test auth.** `dev-login` (env-gated, session-minting shim) for
   hermetic CI and quick local iteration; a **Keycloak container** (dev-only) as a
   mock OIDC provider so the real redirect → callback → token-validation path can be
   exercised locally without a real tenant. Keycloak is never in the production
   path — prod points the same code at Entra via config.
4. **App-access group gate.** Only members of a designated Entra group may obtain a
   session; tenant membership alone is not enough.
5. **Token claims + Graph.** Group membership is read from the ID token's `groups`
   claim; the line manager (sub-project C) will come from Microsoft Graph. The app
   registration is set up with Graph permissions now so C is not blocked.

---

## Architecture & auth flow

**Pattern:** OIDC Authorization Code flow with PKCE. The API is the only component
that talks to Entra. After a successful handshake the API creates a session in the
existing session store and sets the existing cookies, so downstream session
middleware, CSRF double-submit, `/me`, and the entire 6a frontend keep working
unchanged.

**Login flow:**

1. Browser navigates to `GET /api/v1/auth/login`. The API generates `state`,
   `nonce`, and a PKCE `code_verifier`, stores them in a short-lived signed,
   httpOnly cookie, and redirects to the Entra `authorize` endpoint.
2. The user authenticates with Microsoft. Entra redirects back to
   `GET /api/v1/auth/callback?code=…&state=…`.
3. The API validates `state`, exchanges the code for tokens (PKCE verifier +
   client secret), and **validates the ID token**: JWKS signature, `iss`, `aud`,
   `nonce`, `exp`.
4. It reads `oid`, `email`/`preferred_username`, `name`, and the `groups` claim.
5. **Access gate:** if the user is not a member of `APP_ACCESS_GROUP_ID`, respond
   `403` and create no session. Otherwise JIT-upsert the user (by `entraOid`),
   create a session, set the `session` + `csrf_token` cookies, and redirect to `/`.

**Library:** use a vetted OIDC client (`openid-client`) for state/nonce/PKCE
handling and token validation rather than hand-rolling — authentication is not a
place to DIY cryptographic validation.

**Config-driven, not Entra-hardcoded.** The client is configured entirely from env:
the issuer is resolved from a discovery URL (`OIDC_ISSUER_URL`), and the claims it
depends on are mapped by name (`OIDC_IDENTITY_CLAIM`, `OIDC_GROUPS_CLAIM`,
`OIDC_EMAIL_CLAIM`, `OIDC_NAME_CLAIM`). This is what makes Keycloak-dev and
Entra-prod differ only in configuration:

| Config | Dev (Keycloak) | Prod (Entra) |
|---|---|---|
| `OIDC_ISSUER_URL` | `http://keycloak:8080/realms/dev` | `https://login.microsoftonline.com/{tenant}/v2.0` |
| identity claim | `sub` | `oid` |
| groups claim | `groups` | `groups` |
| client id / secret | Keycloak client | Entra app registration |

The immutable identity value read via `OIDC_IDENTITY_CLAIM` is stored as
`entraOid` (name kept for continuity; it holds whatever stable subject the IdP
issues).

**Removed from Plan 2:** password hashing, the password `POST /auth/login`, the
login rate-limiter, and the `seed:admin` script. These are replaced by SSO. First
admin access is granted by Entra group membership (sub-project B maps the group to
the admin role).

---

## Endpoints

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/auth/login` | any | Start OIDC — set PKCE/state cookie, redirect to Entra |
| GET | `/auth/callback` | any | Validate token, enforce access gate, JIT-provision, create session, redirect to `/` |
| POST | `/auth/logout` | auth | Clear local session + cookies; return the Entra `end_session` URL for the SPA to redirect to |
| GET | `/me` | auth | **Unchanged** — returns the session user |
| POST | `/auth/dev-login` | dev only | Env-gated: mint a session for `{ email, groups[] }`; hard-disabled when `DEV_LOGIN` is not `true` |

**Frontend change:** the 6a login page becomes a single "Sign in with Microsoft"
button linking to `/api/v1/auth/login`. Everything behind the route guard is
untouched. (Full UI polish is sub-project D; this is the minimal change to make
login functional.)

---

## Data model — `users` table

- **Remove:** `passwordHash`.
- **Add:** `entraOid` (text, unique, not null — the immutable identity key);
  `groupsSnapshot` (jsonb array of group object IDs captured at login, so
  sub-project B can map them to roles without re-querying Entra).
- **Keep:** `id` (uuidv7, still the FK target for `audit_logs.actor_id`,
  `batches.created_by`, `batches.approved_by`), `email`, `displayName`, `isActive`.
- **Untouched here:** the `role` column/enum. The 3-role change (drop maker/viewer)
  is sub-project B. In A, JIT upsert writes only identity fields
  (`entraOid`, `email`, `displayName`, `groupsSnapshot`, `isActive`).

**JIT provisioning:** on each successful login, insert-or-update the user row keyed
by `entraOid`. No signups, no manual admin provisioning step.

---

## Configuration (new env)

| Var | Purpose |
|---|---|
| `OIDC_ISSUER_URL` | IdP issuer; endpoints resolved from its `…/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` | Client ID (Entra app registration / Keycloak client) |
| `OIDC_CLIENT_SECRET` | Client secret |
| `OIDC_REDIRECT_URI` | `…/api/v1/auth/callback` |
| `OIDC_IDENTITY_CLAIM` | Immutable subject claim (`oid` for Entra, `sub` for Keycloak) |
| `OIDC_GROUPS_CLAIM` | Groups claim name (default `groups`) |
| `OIDC_EMAIL_CLAIM` / `OIDC_NAME_CLAIM` | Email + display-name claim names |
| `APP_ACCESS_GROUP_ID` | Group whose members may sign in |
| `DEV_LOGIN` | `true` enables `/auth/dev-login` (never in prod) |

Endpoints are resolved from the issuer's OIDC discovery document. For Entra, the
app registration is configured to emit **only app-assigned groups** in the token
(avoids the groups "overage" limit) and is granted Microsoft Graph permission so
sub-project C can look up the manager.

Local dev also keeps `COOKIE_SECURE=false` for http://localhost (a `Secure` cookie
is never sent over plain http).

---

## Dev / test story & test migration

Two layers, different jobs:

- **`dev-login`** (env-gated session-minting shim) — for automated tests, CI, and
  quick local iteration. Hermetic and fast; does **not** exercise the OIDC path.
- **Keycloak container** (dev-only, in the local docker-compose) — a mock OIDC
  provider so the real redirect → callback → token-validation flow can be tested
  locally without a real tenant. Preloaded from a checked-in **realm-export**
  (a `dev` realm with a client, test users, and groups incl. the app-access group).
  Because the OIDC client is config-driven, switching to Entra in production is an
  env-var change only; Keycloak never ships to production.

The significant cost is the **test migration**: every existing backend test
currently authenticates via the Plan 2 password flow. They migrate to a
`dev-login`/session test helper. This is mechanical but spans many test files
across Plans 2–6 and is the largest single chunk of work in A.

`dev-login` is gated by `DEV_LOGIN=true` and must be provably inert in production
(guarded at route registration and re-checked in the handler; covered by a test
asserting `404`/`403` when the flag is off).

---

## Testing approach

- **Callback unit tests** with a stubbed token exchange and JWKS:
  - valid token, member of app-access group → session created, cookies set;
  - valid token, not in app-access group → `403`, no session;
  - invalid/expired/tampered token → `401`.
- **`dev-login` tests:** mints a working session with chosen groups when enabled;
  hard-disabled when `DEV_LOGIN` is not `true`.
- **Session continuity:** existing session middleware, CSRF, and `/me` behavior
  unchanged after a session is issued via callback or dev-login.
- **Config-driven claim mapping:** the identity/groups/email/name claims are read
  by configured name, verified against both a Keycloak-shaped token (`sub`) and an
  Entra-shaped token (`oid`) so the same code path serves dev and prod.
- Full backend suite green after the test-auth migration.

---

## Out of scope for A

- Group → role mapping and the 3-role model (admin / approver / user) → **B**.
- Line-manager lookup and the two-stage approval workflow → **C**.
- Login-screen visual redesign and broader UI polish → **D**.

## Future options (not decided here)

- **SCIM provisioning.** Revisit in sub-projects B/C: Entra can provision users,
  group memberships, and the manager attribute *into* the app's DB via SCIM, which
  would let B/C read roles and the line manager locally instead of calling
  Microsoft Graph at runtime. It is a provisioning/sync mechanism, **not** an
  authentication path (OIDC still logs users in). Adds a SCIM endpoint + an Entra
  Enterprise App provisioning config — worth it only if runtime Graph calls become
  a pain. Recorded here so B/C can weigh it against direct Graph lookups.

---

## Self-review notes

- **Placeholders:** none — all endpoints, env vars, and data-model changes are
  concrete.
- **Consistency:** the `role` column is explicitly deferred to B and not written in
  A; JIT upsert lists exactly the identity fields it touches.
- **Scope:** single implementation plan — SSO auth + session + gate + JIT + test
  migration. Roles and workflow are separate specs.
- **Ambiguity:** "access gate" is defined precisely as membership in
  `APP_ACCESS_GROUP_ID`, enforced in the callback before any session is created.
