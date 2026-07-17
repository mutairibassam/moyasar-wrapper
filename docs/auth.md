# Authentication (Microsoft SSO)

The platform authenticates operators via **Microsoft Entra ID (Azure AD)** using
OIDC Authorization Code flow + PKCE. The Bun/Hono API is the backend-for-frontend:
it runs the OIDC handshake and issues the existing httpOnly `session` +
`csrf_token` cookies, so the web app, session middleware, CSRF, and `/me` are
unchanged. There are no native accounts, signups, or passwords for login.

## Flow

1. Browser → `GET /api/v1/auth/login`: the API generates `state`/`nonce`/PKCE,
   stores them in a short-lived `oidc_tx` cookie, and redirects to the IdP.
2. IdP authenticates the user, redirects to `GET /api/v1/auth/callback`.
3. The API validates the ID token, reads the identity/groups claims, and enforces
   the **app-access gate**: the user must be a member of `APP_ACCESS_GROUP_ID`, else
   `401` and no session.
4. The user is JIT-provisioned (upsert by the immutable subject claim → `entra_oid`),
   a session is created, cookies are set, and the browser is redirected to `/`.

SSO-provisioned users get the `viewer` role by default. Group→role mapping and the
3-role model arrive in sub-project **B**; the line-manager approval workflow in **C**.

## Config-driven OIDC (dev → prod is env-only)

Nothing about Entra is hardcoded. The issuer and claim names come from env, so the
same code runs against Keycloak in dev and Entra in prod:

| Env var | Dev (Keycloak) | Prod (Entra) |
|---|---|---|
| `OIDC_ISSUER_URL` | `http://localhost:8081/realms/dev` | `https://login.microsoftonline.com/<tenant>/v2.0` |
| `OIDC_CLIENT_ID` | `app` | app-registration client id |
| `OIDC_CLIENT_SECRET` | `dev-secret` | app-registration secret |
| `OIDC_REDIRECT_URI` | `http://localhost:3000/api/v1/auth/callback` (web origin) | `https://<host>/api/v1/auth/callback` |
| `OIDC_IDENTITY_CLAIM` | `sub` | `oid` |
| `OIDC_GROUPS_CLAIM` | `groups` | `groups` |
| `APP_ACCESS_GROUP_ID` | `invoice-app-users` (group name) | the group's object-id GUID |

**Deploying to your company** = fill in the Entra values above. No code change.
The Entra app registration needs: redirect URI, a client secret, the app-access
group, and a token configuration that emits **only app-assigned groups** in the
`groups` claim (avoids the groups "overage" limit), plus Microsoft Graph permission
for sub-project C's line-manager lookup.

## Local development

Two layers of auth for dev/test:

- **`dev-login`** (`POST /api/v1/auth/dev-login`, enabled only when `DEV_LOGIN=true`)
  mints a session for `{ email, role }` with no IdP round-trip. Used by the test
  suite and quick local iteration. Hard-disabled (`404`) in production.
- **Keycloak** (dev-only, `docker-compose.dev.yml`) is a mock OIDC provider to
  exercise the real redirect → callback → token-validation flow without a tenant.

```bash
cp apps/api/.env.example apps/api/.env    # fill KEY_ENCRYPTION_KEY
docker compose -f docker-compose.dev.yml up -d   # Postgres :5433 + Keycloak :8081
bun run --filter '@moyasar-ops/db' migrate
cd apps/api && bun run dev                 # API on :8080
cd apps/web && bun run dev                 # web on :3000
```

The dev realm ships two users (password `password`): **alice** (in
`invoice-app-users` → can sign in) and **bob** (not a member → gets `403`).

### Manual SSO smoke

1. Open `http://localhost:3000` → "Sign in with Microsoft" → Keycloak.
2. Sign in as **alice** → lands on the dashboard (session issued).
3. Sign in as **bob** → rejected at the app-access gate.
4. Log out → session cleared.

## Production deployment caveats (sub-project A)

These are required or must be understood before shipping A standalone; several are
resolved by sub-project **B**:

- **Groups "overage" must be avoided.** Configure the Entra app registration to emit
  **only app-assigned groups** in the `groups` claim. If a user belongs to too many
  groups, Entra omits the claim entirely, and the app-access gate would then reject a
  legitimate member with `401`.
- **First admin.** Every SSO/JIT user defaults to `role = viewer` (group→role mapping
  is sub-project B). A fresh deployment therefore has **no admin** until B lands or an
  admin role is set directly in the database. Plan for this.
- **Do not pre-create SSO users by email.** JIT provisioning upserts on `entra_oid`;
  a pre-existing row with the same `email` but a different/NULL `entra_oid` (e.g. from
  the legacy `POST /users` create path) collides with `UNIQUE(email)` and fails that
  user's callback. Email-based reconciliation is deferred to sub-project B.
- **Deactivated users:** the gate checks group membership only, so a session is minted
  at callback even for an inactive user — but every subsequent request is rejected by
  `resolveSession` (which enforces `isActive`), so no access is granted. An `isActive`
  check at the gate is deferred to B.
