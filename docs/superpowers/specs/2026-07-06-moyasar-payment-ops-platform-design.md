# Moyasar Payment Operations Platform — MVP Design

**Date:** 2026-07-06
**Status:** Approved
**Scope:** MVP of an internal enterprise orchestration platform wrapping the Moyasar Payment APIs. This is **not** a payment gateway; it sits between business users and Moyasar to provide bulk invoice creation, validation, maker-checker review, submission, status tracking, and a complete audit trail.

---

## 1. Goals and non-goals

### Goals (MVP)

1. Business users prepare invoice batches safely (CSV upload or in-app grid) with row-level validation before anything reaches Moyasar.
2. Strict maker-checker: every batch requires approval by a different user before submission.
3. Reliable bulk submission to Moyasar (chunked at the API's 50-invoice limit) that is safe to retry after crashes or timeouts.
4. Invoice status stays current via Moyasar payment webhooks plus periodic polling reconciliation.
5. Append-only audit trail covering every state change, with actor, before/after, and timestamps.
6. Role-based access: `admin`, `maker`, `approver`, `viewer`.

### Non-goals (MVP)

- No SSO/OIDC (email/password now; the org IdP integration comes later — the auth module is designed so sessions/RBAC survive swapping the credential verification step).
- No multi-merchant support: one Moyasar account with a test-mode and live-mode key pair.
- No refunds/payouts/settlement features.
- No public API for other internal systems (CSV + grid are the only intake paths in MVP).

---

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Approval workflow | Strict maker-checker on every batch; approver ≠ creator, enforced server-side |
| Authentication | Email/password + roles for MVP; org IdP later |
| Bulk intake | CSV/Excel upload **and** in-app editable grid |
| Moyasar accounts | Single account, test + live key pair, global mode switch |
| Status sync | Webhooks (payment events) + polling reconciliation |
| Deployment | Docker Compose on a VM |
| Architecture | Modular monolith (Approach A) |

---

## 3. Moyasar API constraints (verified against docs, 2026-07-06)

- **Create Invoice** `POST /v1/invoices` — required: `amount` (integer, smallest currency unit, min 100), `currency` (ISO-4217), `description`. Optional: `callback_url`, `success_url`, `back_url`, `expired_at` (ISO 8601), `metadata` (string key/value pairs, searchable via list APIs). Response includes `id` (uuid), `status`, checkout `url`, `payments[]`.
- **Bulk Invoice** `POST /v1/invoices/bulk` — `invoices[]`, **max 50 per request**. Partial-failure semantics are not documented; treat any non-201 as ambiguous and reconcile (see §7.3). No idempotency keys.
- **List Invoices** `GET /v1/invoices` — page-based pagination (`page`, `meta.next_page`), filters: `status`, `created[gt]`, `created[lt]`, `metadata[key]`.
- **Cancel Invoice** `PUT /v1/invoices/:id/cancel` — returns invoice with `status: canceled`; prevents further payment.
- **Invoice statuses:** `initiated, paid, failed, refunded, canceled, on_hold, expired, voided`.
- **Webhooks** — payment-level events only (`payment_paid`, `payment_failed`, `payment_refunded`, `payment_voided`, `payment_authorized`, `payment_captured`, `payment_verified`); **no invoice-level events**, so `expired`/`canceled` can only be detected by polling. Payload carries a merchant-configured `secret_token` for verification. Moyasar retries failed deliveries 5 times (1m, 10m, 30m, 1h, 2h) then drops.
- **Auth:** HTTP Basic with the secret API key.

Implication: webhooks give real-time "paid"; polling is mandatory for expiry/cancel detection and heals missed webhooks.

---

## 4. Architecture

Bun workspaces monorepo, modular monolith:

```
moyasar-wrapper/
├── apps/
│   ├── api/                  # Bun + Hono REST API
│   │   └── src/
│   │       ├── modules/      # auth, users, batches, invoices, moyasar, audit, webhooks, jobs
│   │       ├── container.ts  # composition root (constructor injection, no DI framework)
│   │       ├── middleware/   # session, rbac, csrf, rate-limit, error-mapper
│   │       └── index.ts
│   └── web/                  # Next.js 15 App Router, TS, Tailwind, shadcn/ui
├── packages/
│   ├── shared/               # Zod schemas, DTOs, enums, money utils — single source of truth
│   └── db/                   # Drizzle schema, migrations, repositories
├── docker-compose.yml
└── docs/superpowers/specs/
```

- Each API module is vertical: `routes → service → repository`. Services depend on repository **interfaces**; Drizzle implementations live in `packages/db`. Cross-module calls go through service interfaces only.
- **HTTP/2:** terminated at a Caddy reverse-proxy container (TLS + h2) fronting both `web` and `api`; the Bun process serves plain HTTP behind it.
- Background work (submission, sync) runs in-process in the API via a Postgres-backed job runner (§7.4). The module seams allow extracting a worker service later without redesign.

---

## 5. Data model (PostgreSQL, Drizzle ORM)

All money values are integers in the smallest currency unit (halalas for SAR). Timestamps are `timestamptz`. Primary keys are UUIDv7.

- **users** — `id, email (unique, citext), password_hash (argon2id), display_name, role (admin|maker|approver|viewer), is_active, created_at, updated_at`
- **sessions** — `id, user_id, token_hash, expires_at, ip, user_agent, created_at`
- **invoice_batches** — `id, name, status, source (csv|manual), created_by, submitted_for_approval_at, approved_by, approved_at, rejection_comment, submitted_at, completed_at, item_count, total_amount, currency, mode (test|live), created_at, updated_at`
- **invoice_items** — `id, batch_id, row_number, amount, currency, description, expired_at, callback_url, success_url, back_url, metadata (jsonb), validation_errors (jsonb, null when valid), status (draft|valid|invalid|submitting|submitted|failed), moyasar_invoice_id, moyasar_status, moyasar_url, last_synced_at, created_at, updated_at`
- **audit_logs** — append-only: `id, actor_id (nullable for system), action, entity_type, entity_id, before (jsonb), after (jsonb), ip, created_at`. The application DB role has no UPDATE/DELETE grant on this table.
- **app_settings** — single row: `moyasar_test_key_enc, moyasar_live_key_enc` (AES-256-GCM, master key from env), `active_mode (test|live)`, `webhook_secret_enc`, `updated_by, updated_at`
- **webhook_events** — `id, event_type, moyasar_payment_id, moyasar_invoice_id, payload (jsonb), status (received|processed|failed|ignored), error, received_at, processed_at`
- **jobs** — `id, type (submit_batch|sync_invoices), payload (jsonb), status (pending|running|done|failed), attempts, max_attempts, run_at, locked_at, locked_by, last_error, created_at`

Every invoice created at Moyasar carries `metadata: { platform_item_id, platform_batch_id }` — the durable join key for reconciliation.

---

## 6. Batch lifecycle (maker-checker)

```
draft ──submit-for-approval──▶ pending_approval ──approve──▶ approved ──job──▶ submitting ──▶ submitted
  ▲                                   │                                             │
  └────────────── rejected ◀──reject──┘                                             └──▶ partially_failed
```

Rules, enforced in the service layer inside DB transactions:

1. Items are editable only while the batch is `draft` (or `rejected`, which reopens as draft-editable).
2. A batch may enter `pending_approval` only when it has ≥1 item and zero `invalid` items.
3. `approve`/`reject` require the `approver` (or `admin`) role **and** `approved_by ≠ created_by` — no self-approval, ever, including admins.
4. Rejection requires a comment and returns the batch to `rejected` (editable); the maker resubmits.
5. Approval snapshots totals + mode and enqueues one `submit_batch` job. From that point the batch is immutable.
6. Every transition writes an audit entry in the same transaction.

---

## 7. Moyasar integration

### 7.1 Client module

Typed wrapper over `fetch`: Basic auth with the decrypted secret key for the active mode, request timeout (15 s), Zod-parsed responses (API drift fails loudly), retry with jittered exponential backoff on 429/5xx **only for idempotent calls** (list, fetch, cancel). Bulk-create is never blindly retried — see 7.3.

### 7.2 Submission engine

The `submit_batch` job:

1. Loads the batch's `valid` items, splits into chunks of ≤50.
2. Per chunk: mark items `submitting` (persisted before the HTTP call), call `POST /invoices/bulk`, then persist returned `moyasar_invoice_id`/`url`/`status` per item (matched by array order and verified against `metadata.platform_item_id`).
3. Chunk outcomes: all persisted → items `submitted`; definitive 4xx → items `failed` with the error recorded; ambiguous outcome (timeout, 5xx, crash) → reconcile before any retry (7.3).
4. Batch ends `submitted` (all items submitted) or `partially_failed` (mix); failed items are listed with reasons and can be cloned into a new draft batch by a maker.

### 7.3 Idempotency / crash recovery

Because bulk-create has no idempotency key, any retry path starts with reconciliation: `GET /invoices?metadata[platform_batch_id]=<id>` (paginated) to discover which items already exist at Moyasar; those are healed to `submitted` with their IDs, and only genuinely missing items are re-sent. Items stuck in `submitting` after a crash are resolved the same way when the job re-runs.

### 7.4 Job runner

In-process loop polling the `jobs` table with `SELECT … FOR UPDATE SKIP LOCKED`, at-least-once execution, exponential backoff on failure up to `max_attempts`, dead jobs surfaced in an admin health panel. A recurring `sync_invoices` job is self-rescheduling.

### 7.5 Webhooks

`POST /api/v1/webhooks/moyasar`: verify `secret_token` (constant-time compare against the stored secret), insert raw event into `webhook_events`, respond `200` immediately, process asynchronously. Processing maps `payment_paid` (and other payment events) to the owning invoice item via the payment's invoice id / metadata; unknown invoices are marked `ignored` (visible for debugging). Duplicate deliveries are idempotent (keyed on event payload identity).

### 7.6 Polling reconciliation

`sync_invoices` runs every 5 minutes: lists our local items whose `moyasar_status` is `initiated`, queries Moyasar (by `metadata[platform_batch_id]` per active batch, and `created[gt]` windows), and updates local status. This is the only mechanism that detects `expired`/`canceled` and it heals missed webhooks. A per-invoice and per-batch "Refresh now" button triggers the same logic on demand.

### 7.7 Cancel

Admins and approvers may cancel a submitted, still-`initiated` invoice (`PUT /invoices/:id/cancel`), with confirmation dialog and audit entry.

---

## 8. Security

- **Sessions:** httpOnly, Secure, SameSite=Lax cookies; token stored hashed; 12 h idle expiry; CSRF token (double-submit) required on all mutating routes.
- **Passwords:** argon2id; rate limiting on `/auth/login` (per-IP and per-account); generic error messages.
- **RBAC:** route-level middleware plus service-layer re-checks on sensitive transitions (approve, settings, cancel). Viewer = read-only; maker = create/edit drafts; approver = review/approve/cancel; admin = users + settings (admins do not bypass maker-checker).
- **Secrets:** Moyasar keys and webhook secret encrypted at rest (AES-256-GCM, master key from env/Compose secret); write-only via API (never echoed back; masked in UI); decrypted only inside the moyasar module.
- **Mode safety:** the active test/live mode is displayed persistently in the UI header; batches record the mode they were approved under; switching mode requires admin and is audited.
- **Input validation:** every request body/query parsed with shared Zod schemas; unknown keys stripped.
- **Transport:** TLS at Caddy; internal containers on a private Compose network.

---

## 9. Audit trail

`audit.record(tx, { actor, action, entity, before, after, ip })` called inside the same transaction as the mutation. Actions include: `user.login`, `user.created`, `user.role_changed`, `batch.created`, `batch.items_changed`, `batch.submitted_for_approval`, `batch.approved`, `batch.rejected`, `batch.submission_started`, `item.submitted`, `item.failed`, `invoice.status_changed` (system actor), `invoice.canceled`, `settings.changed`, `mode.switched`. UI: per-batch activity tab + global audit explorer (admin), filterable by actor/action/entity/date.

---

## 10. Frontend (Next.js)

- **Pages:** login · dashboard (batch pipeline, totals, recent activity, jobs health for admins) · batches list · batch detail (tabs: Items grid / Review / Activity) · new-batch wizard · invoices explorer (filters: status/date/batch; refresh-now) · settings (keys masked, mode switch, users) — all role-gated server-side and in the UI.
- **New-batch wizard:** (1) name + currency + defaults (expiry, URLs applied to all rows unless overridden) → (2) intake: CSV upload **or** empty grid → (3) validate: server returns per-row errors rendered inline in the grid; user edits cells to fix; revalidate → (4) save draft / submit for approval.
- **CSV format:** documented template with header row `amount,description,expired_at,success_url,back_url,callback_url,metadata.*`; amounts accepted in major units (e.g., `149.99`) and converted to halalas at the parse boundary; all display formatted via a shared money util. Excel (`.xlsx`) accepted and converted server-side.
- **Data layer:** TanStack Query (polling every 5 s on batches in `submitting`), TanStack Table for grids (virtualized above 200 rows), React Hook Form + shared Zod resolvers, shadcn/ui components, problem+json errors mapped to toasts/field errors.

---

## 11. API surface (REST, `/api/v1`, JSON, problem+json errors)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /me` |
| Users (admin) | `GET/POST /users`, `PATCH /users/:id` (role, active, password reset) |
| Batches | `GET /batches`, `POST /batches`, `GET /batches/:id`, `PATCH /batches/:id` (draft), `POST /batches/:id/csv` (multipart), `POST /batches/:id/items:bulk-upsert`, `DELETE /batches/:id/items/:itemId`, `POST /batches/:id/submit-for-approval`, `POST /batches/:id/approve`, `POST /batches/:id/reject`, `POST /batches/:id/clone-failed` |
| Invoices | `GET /invoices` (local mirror, filters + pagination), `GET /invoices/:id`, `POST /invoices/:id/cancel`, `POST /invoices/refresh` |
| Audit | `GET /audit` (admin; filters) |
| Settings | `GET /settings` (masked), `PUT /settings/keys`, `PUT /settings/mode` |
| Webhooks | `POST /webhooks/moyasar` (unauthenticated route, secret-token verified) |
| Ops | `GET /healthz`, `GET /jobs` (admin) |

---

## 12. Error handling

Typed hierarchy — `ValidationError (400)`, `AuthnError (401)`, `AuthzError (403)`, `NotFoundError (404)`, `StateTransitionError (409)`, `MoyasarApiError (502, with upstream detail)` — mapped centrally by one error middleware to RFC 7807 `application/problem+json`. No silent catches anywhere: webhook and job failures are persisted with errors and surfaced in the admin health panel; logs are structured (pino) with request IDs propagated end-to-end.

---

## 13. Testing strategy

- **Unit (bun test):** services with in-memory repository fakes — batch state machine (all legal/illegal transitions), maker≠checker enforcement, chunking at 50, reconciliation/crash-recovery logic, money conversion edge cases (rounding, min 100).
- **Integration:** repositories + job runner against real dockerized Postgres (Testcontainers-style); `FOR UPDATE SKIP LOCKED` claiming under concurrency.
- **Moyasar client:** contract tests against a local mock server fixture replaying real response shapes (success, 400 validation, 429, timeout).
- **Shared schemas:** Zod round-trip tests; CSV parser golden files (valid, mixed-error, BOM/encoding, Excel).
- **Web:** component tests for grid validation UX and wizard flow; one Playwright happy-path E2E (create → approve → submit against mock Moyasar) in CI.

---

## 14. Deployment (Docker Compose)

Services: `caddy` (TLS, HTTP/2, reverse proxy) → `web` (Next standalone) + `api` (Bun); `postgres:17` with named volume. Drizzle migrations run as an API start-up gate. Configuration via env file; secrets (master key, DB password) via Compose secrets. `restart: unless-stopped`, health checks on `/healthz`, pino JSON logs to stdout for collection. Webhook path requires the VM to be reachable from Moyasar over HTTPS; if it isn't at go-live, polling alone keeps statuses correct (webhooks are an enhancement, not a dependency).

---

## 15. Build order (for the implementation plan)

1. Monorepo scaffold, packages/shared + packages/db, Drizzle schema + migrations, Docker Compose with Postgres.
2. API skeleton: Hono, composition root, error middleware, health.
3. Auth + users + sessions + RBAC + audit foundation.
4. Batches + items: CRUD, CSV/grid intake, validation pipeline.
5. Maker-checker transitions.
6. Moyasar client + settings (encrypted keys, mode).
7. Job runner + submission engine + reconciliation.
8. Webhooks + polling sync + cancel.
9. Web app: auth pages → wizard/grid → review/approval → invoices explorer → settings/audit.
10. E2E, Compose hardening, docs.
