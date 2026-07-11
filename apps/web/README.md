# @moyasar-ops/web

Operator console for the Moyasar payment-ops platform — a Next.js (App Router,
React 19) client-rendered SPA that drives the Bun/Hono REST API.

## Architecture

- **Client-rendered.** All pages are client components using TanStack Query.
  Auth state comes from `GET /api/v1/me` behind a route-guard layout, not from
  reading the httpOnly session cookie.
- **Same-origin only.** The browser only ever calls the relative `/api/v1/*`.
  `next.config.ts` rewrites `/api/:path*` to the API origin (`API_ORIGIN`), so
  the existing `session` / `csrf_token` cookies and CSRF double-submit work with
  zero backend changes and no CORS.
- **Shared contracts.** Validation schemas, enums and money helpers are imported
  from `@moyasar-ops/shared`; DTOs mirrored in `src/lib/api/types.ts`.

## Setup

```bash
# from the repo root
bun install

# point the web app at your running API (defaults to http://localhost:8080)
cp apps/web/.env.local.example apps/web/.env.local
```

## Scripts (run from `apps/web`)

```bash
bun run dev        # next dev on :3000
bun run build      # production build
bun run start      # serve the production build on :3000
bun run typecheck  # tsc --noEmit (strict, no any)
bun run test       # vitest (RTL + jsdom + MSW)
```

From the repo root, `bun run test:web` runs this suite via the workspace filter;
`bun run test` runs only the bun-native API/db suites (they use different test
runners, so they are kept separate).

## Manual smoke test (against a running API)

1. Start the API on `:8080` and this app with `bun run dev`, then open
   `http://localhost:3000`.
2. **Login** with a seeded admin.
3. **Settings** → confirm active mode + set a test key.
4. **Users** → create a `maker` and an `approver`.
5. As the maker: **New batch** → add items in the grid (or import a CSV) →
   **Submit for approval**.
6. As the approver: open the batch → **Approve** (note you cannot approve a
   batch you created — no self-approval).
7. Watch the batch move to `submitting`/`submitted`; use **Refresh statuses**.
8. **Invoices** → filter by status; **Cancel** an `initiated` invoice.
9. **Audit** → confirm the approve/reject/cancel actions were logged; open a
   row's details to inspect before/after JSON.

> Containerized single-origin deployment (Next standalone behind Caddy with the
> API) is Plan 6b.
