# Moyasar Client & Submission Engine (Plan 4 of 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an `approved` batch into real Moyasar invoices — an encrypted settings store for the API keys + active mode, a typed Moyasar client, a Postgres-backed job runner, and a crash-safe submission engine that chunks at Moyasar's 50-invoice limit and reconciles by metadata so a retry never double-creates.

**Architecture:** Secrets (Moyasar keys, webhook secret) are encrypted at rest with AES-256-GCM under a master key from the environment and decrypted only inside the moyasar module. A `SettingsService` owns the singleton `app_settings` row. The `MoyasarClient` is a typed `fetch` wrapper (HTTP Basic with the decrypted secret key for the active mode, Zod-parsed responses). A `jobs` repository joins the existing `Repositories` bundle; an in-process `JobRunner` claims jobs with `FOR UPDATE SKIP LOCKED`. The `SubmissionEngine` is the `submit_batch` job handler: it marks items `submitting` (persisted before the HTTP call), bulk-creates in chunks, records Moyasar ids/urls/statuses, and on any ambiguous outcome reconciles via `GET /invoices?metadata[platform_batch_id]=…` before re-sending. `approve()` now reads the active mode from settings and enqueues the job.

**Tech Stack:** Bun ≥1.2 (`node:crypto` for AES-256-GCM, `fetch`), Hono 4, Drizzle ORM 0.45 (raw SQL for `FOR UPDATE SKIP LOCKED`), Zod 4, PostgreSQL 17. No new runtime dependency.

**Plan roadmap:** Plan 4 of 6, stacked on `feature/auth` (Plans 2–3). Deliberately ends at invoices created at Moyasar with local statuses recorded at submission time. **Deferred to Plan 5:** polling reconciliation of ongoing status (paid/expired/canceled), cancel, and a per-invoice "refresh now". **Deferred as a later enhancement:** the inbound webhook receiver (Moyasar has no invoice-level events and the MVP may not be internet-exposed; polling in Plan 5 keeps statuses correct). Frontend is Plan 6.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-06-moyasar-payment-ops-platform-design.md` (binding here: §3 Moyasar API constraints, §5 data model/secrets, §7 Moyasar integration, §8 security, §9 audit, §12 errors).
- Workspace prefix `@moyasar-ops/`. TypeScript `strict: true`; no `any` (sanctioned: the `$client` cast in integration-test `afterAll`).
- **Money stays integer minor units.** Moyasar `amount` is an integer in the smallest currency unit, min **100**. Our stored `amount` is already in that unit — send it as-is.
- **Bulk create limit: 50 invoices per request** (`POST /v1/invoices/bulk`). Chunk strictly at ≤50.
- **Moyasar auth:** HTTP Basic, username = the secret API key, password empty. Base URL default `https://api.moyasar.com/v1`.
- **No idempotency key on bulk create.** Any non-definitive outcome (timeout, 5xx, or a crash mid-submit) MUST trigger reconciliation (`GET /invoices?metadata[platform_batch_id]=<id>`, paginated) before re-sending; items already present at Moyasar are healed, only genuinely missing items are re-sent. Idempotent calls (list) may retry with jittered exponential backoff on 429/5xx; bulk create is never blindly retried.
- **Every invoice created at Moyasar carries `metadata: { platform_item_id: <item uuid>, platform_batch_id: <batch uuid> }`** — the durable reconciliation join key (spec §7.3). No schema change: those are the existing item/batch UUIDs. **The reserved keys MUST win over the item's own metadata** — build the object as `{ ...item.metadata, platform_item_id, platform_batch_id }` (reserved keys spread LAST). A user can supply a CSV `metadata.platform_item_id` column; if it overrode the join key, a crash/retry would double-create.
- **Secrets encrypted at rest** with AES-256-GCM; master key from `KEY_ENCRYPTION_KEY` env (32 bytes, base64). Keys are write-only via the API (never echoed; masked in GET), decrypted only inside the moyasar/settings modules.
- **Item states this plan sets:** `valid → submitting → submitted | failed`. **Batch states this plan sets:** `approved → submitting → submitted | partially_failed`. (It never touches `paid`/`expired`/`canceled` — that is Plan 5 polling.)
- **RBAC:** settings routes and the mode switch are `admin` only; the mode switch and key changes are audited (`settings.changed`, `mode.switched`).
- **Errors:** typed `AppError` subclasses; `MoyasarApiError` (502) wraps upstream failures with detail. Central mapper renders problem+json. Job/submission failures are persisted (`jobs.last_error`, item `failed` + reason) and never silently swallowed.
- Tests: unit (crypto, client against a mock `fetch`, engine against a fake client, runner) run with no DB via `bun run test:unit`; integration/API (settings, jobs claim, submission) need Compose Postgres on host port **5433** (`DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops`), run via `bun run test:db`. Integration files are named `*.integration.test.ts`. **No test makes a real Moyasar network call** — the client is exercised against an injected `fetch`/mock server (spec §13).
- Commits: conventional style, one per task minimum, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Existing code this plan builds on (do not recreate)

- `packages/db/src/schema/settings.ts` — `appSettings` singleton (id=1 CHECK): `moyasarTestKeyEnc`, `moyasarLiveKeyEnc`, `webhookSecretEnc`, `activeMode` (`test`/`live` default `test`), `updatedBy`, `updatedAt`.
- `packages/db/src/schema/jobs.ts` — `jobs` (`type` `submit_batch`/`sync_invoices`, `payload` jsonb, `status` `pending`/`running`/`done`/`failed`, `attempts`, `maxAttempts` default 5, `runAt`, `lockedAt`, `lockedBy`, `lastError`), claim index on `(status, run_at)`.
- `packages/db/src/schema/batches.ts` — `invoiceItems` has `moyasarInvoiceId`, `moyasarStatus`, `moyasarUrl`, `lastSyncedAt`; `itemStatusEnum` and `batchStatusEnum` include the submission states.
- `packages/db/src/repositories/` — `Repositories` bundle with `transaction()`, `build(executor, root)`, `createRepositories(db)`; `batches`/`items` repos (Plan 3), `BatchesRepository.update(id, patch, expectedStatus?)` (the Plan 3 TOCTOU guard).
- `apps/api/src/` — `config.ts` (`loadConfig`), `container.ts` (`createContainer(db, config)`), `errors.ts` (incl. `MoyasarApiError`), `middleware/` (`requireRole` etc.), `app.ts`, `modules/batches/batches.service.ts` (`approve()` currently hardcodes `mode: "test"` — this plan replaces that).
- `apps/api/test/support/fake-repositories.ts` — extended per new repos in this plan.

---

### Task 1: Config extension + AES-256-GCM secret crypto

**Files:**
- Create: `apps/api/src/modules/settings/crypto.ts`
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/test/settings/crypto.test.ts`, `apps/api/test/config.test.ts` (extend)

**Interfaces:**
- Consumes: nothing (Node built-ins).
- Produces:
  - `encryptSecret(plaintext: string, keyB64: string): string` and `decryptSecret(blob: string, keyB64: string): string` (blob format `v1.<ivB64>.<tagB64>.<ctB64>`), plus `class CryptoError extends Error`.
  - `Config` gains `keyEncryptionKey: string` (required, 32 bytes base64) and `moyasarBaseUrl: string` (default `https://api.moyasar.com/v1`) and `jobPollIntervalMs: number` (default 2000).

- [ ] **Step 1: Write the failing crypto tests**

`apps/api/test/settings/crypto.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { CryptoError, decryptSecret, encryptSecret } from "../../src/modules/settings/crypto";

const key = randomBytes(32).toString("base64");

describe("secret crypto (AES-256-GCM)", () => {
  test("round-trips a secret", () => {
    const blob = encryptSecret("sk_test_abc123", key);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("sk_test_abc123");
    expect(decryptSecret(blob, key)).toBe("sk_test_abc123");
  });

  test("two encryptions of the same secret differ (random IV)", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  test("decryption fails (throws) with the wrong key", () => {
    const blob = encryptSecret("secret", key);
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptSecret(blob, otherKey)).toThrow();
  });

  test("a tampered ciphertext fails the auth tag", () => {
    const blob = encryptSecret("secret", key);
    const parts = blob.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from("evil").toString("base64")}`;
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  test("rejects a key that is not 32 bytes", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(CryptoError);
  });

  test("rejects a malformed blob", () => {
    expect(() => decryptSecret("not-a-blob", key)).toThrow(CryptoError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test apps/api/test/settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement crypto**

`apps/api/src/modules/settings/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class CryptoError extends Error {}

function keyBytes(keyB64: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(keyB64, "base64");
  } catch {
    throw new CryptoError("KEY_ENCRYPTION_KEY is not valid base64");
  }
  if (key.length !== 32) {
    throw new CryptoError("KEY_ENCRYPTION_KEY must decode to 32 bytes (AES-256)");
  }
  return key;
}

export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = keyBytes(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSecret(blob: string, keyB64: string): string {
  const key = keyBytes(keyB64);
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new CryptoError("Malformed secret blob");
  }
  try {
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const ct = Buffer.from(parts[3]!, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    throw new CryptoError("Failed to decrypt secret (wrong key or corrupted data)");
  }
}
```

- [ ] **Step 4: Extend config**

Edit `apps/api/src/config.ts` — add three fields to `configSchema` and the env mapping:

```ts
const configSchema = z.object({
  databaseUrl: z.string().min(1),
  port: z.coerce.number().int().default(3001),
  sessionTtlMinutes: z.coerce.number().int().default(720),
  cookieSecure: boolFromString,
  loginRateMax: z.coerce.number().int().default(5),
  loginRateWindowMinutes: z.coerce.number().int().default(15),
  keyEncryptionKey: z.string().min(1, "KEY_ENCRYPTION_KEY is required"),
  moyasarBaseUrl: z.string().min(1).default("https://api.moyasar.com/v1"),
  jobPollIntervalMs: z.coerce.number().int().default(2000),
});
```

and in `loadConfig`'s `safeParse` object:

```ts
    keyEncryptionKey: env.KEY_ENCRYPTION_KEY,
    moyasarBaseUrl: env.MOYASAR_BASE_URL,
    jobPollIntervalMs: env.JOB_POLL_INTERVAL_MS,
```

- [ ] **Step 5: Extend the config test**

Add to `apps/api/test/config.test.ts` a `base` that now includes a key, and a test that a missing key fails. Update the existing `base` object to:

```ts
const base = {
  DATABASE_URL: "postgres://u:p@localhost:5433/db",
  KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};
```

and add:

```ts
test("requires KEY_ENCRYPTION_KEY", () => {
  expect(() => loadConfig({ DATABASE_URL: "postgres://u:p@localhost:5433/db" } as NodeJS.ProcessEnv)).toThrow();
});
test("defaults the Moyasar base URL", () => {
  expect(loadConfig(base as NodeJS.ProcessEnv).moyasarBaseUrl).toBe("https://api.moyasar.com/v1");
});
```

(The existing config tests that build on `base` keep working — they just carry the new key field.)

- [ ] **Step 6: Update every place that builds a Config in tests**

Integration/API tests from Plans 2–3 call `loadConfig({ DATABASE_URL: url } as NodeJS.ProcessEnv)`. Add `KEY_ENCRYPTION_KEY` to those env objects so they still parse. Grep for `loadConfig(` under `apps/api/test` and add `KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64")` to each env literal. Also add `.env.example` entries:

```
KEY_ENCRYPTION_KEY=<32 random bytes, base64: `openssl rand -base64 32`>
MOYASAR_BASE_URL=https://api.moyasar.com/v1
```

- [ ] **Step 7: Run tests + typecheck**

Run: `bun run typecheck && bun run test:unit`
Expected: PASS (crypto tests + updated config tests; the pre-existing api tests still parse config with the new key).

Then run the DB-backed tests to confirm the config change didn't break them:
Run: `DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops bun test packages/db apps/api/test/api`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api .env.example
git commit -m "feat(api): AES-256-GCM secret crypto and Moyasar/encryption config"
```

---

### Task 2: Settings repository + SettingsService

**Files:**
- Create: `packages/db/src/repositories/settings.repository.ts`
- Modify: `packages/db/src/repositories/types.ts` (SettingsRow types + interface + bundle member)
- Modify: `packages/db/src/repositories/index.ts` (construct in `build`)
- Modify: `apps/api/test/support/fake-repositories.ts` (in-memory settings)
- Create: `apps/api/src/modules/settings/settings.service.ts`
- Test: `packages/db/test/settings-repository.integration.test.ts`, `apps/api/test/settings/settings.service.test.ts`

**Interfaces:**
- Consumes: `appSettings` table; `encryptSecret`/`decryptSecret` (Task 1); `Config.keyEncryptionKey`.
- Produces:
  - `type SettingsRow = typeof appSettings.$inferSelect`.
  - `interface SettingsRepository { get(): Promise<SettingsRow>; update(patch: Partial<typeof appSettings.$inferInsert>): Promise<SettingsRow> }` — `get()` upserts the singleton row (id=1) if missing.
  - `Repositories` gains `settings: SettingsRepository`.
  - `class SettingsService` with `view(): Promise<SettingsView>` (masked: `{ activeMode, testKeySet, liveKeySet, updatedAt }`), `setKey(actor, mode: Mode, key: string, ctx): Promise<void>`, `setMode(actor, mode: Mode, ctx): Promise<void>`, and `activeSecretKey(): Promise<string>` (decrypts the key for the active mode; throws `ValidationError` if unset — used only by the moyasar module).

- [ ] **Step 1: Extend `types.ts`**

Add `appSettings` to the schema import, then:

```ts
export type SettingsRow = typeof appSettings.$inferSelect;
export type NewSettingsRow = typeof appSettings.$inferInsert;

export interface SettingsRepository {
  get(): Promise<SettingsRow>;
  update(patch: Partial<NewSettingsRow>): Promise<SettingsRow>;
}
```

and add `settings: SettingsRepository;` to the `Repositories` interface.

- [ ] **Step 2: Implement the settings repository**

`packages/db/src/repositories/settings.repository.ts`:

```ts
import { eq } from "drizzle-orm";
import { appSettings } from "../schema";
import type { Executor, NewSettingsRow, SettingsRepository, SettingsRow } from "./types";

export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Executor) {}

  async get(): Promise<SettingsRow> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    if (row) return row;
    const [created] = await this.db
      .insert(appSettings)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await this.db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    return existing!;
  }

  async update(patch: Partial<NewSettingsRow>): Promise<SettingsRow> {
    await this.get(); // ensure the singleton exists
    const [row] = await this.db
      .update(appSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(appSettings.id, 1))
      .returning();
    return row!;
  }
}
```

- [ ] **Step 3: Wire into `build` and extend the fake**

In `packages/db/src/repositories/index.ts`, import `DrizzleSettingsRepository` and add `settings: new DrizzleSettingsRepository(executor),` to the returned object.

In `apps/api/test/support/fake-repositories.ts`, add a backing row and the repo:

```ts
  settingsRow: SettingsRow = {
    id: 1,
    moyasarTestKeyEnc: null,
    moyasarLiveKeyEnc: null,
    webhookSecretEnc: null,
    activeMode: "test",
    updatedBy: null,
    updatedAt: new Date(),
  };

  settings: SettingsRepository = {
    get: async () => this.settingsRow,
    update: async (patch: Partial<NewSettingsRow>) => {
      this.settingsRow = { ...this.settingsRow, ...patch, updatedAt: new Date() };
      return this.settingsRow;
    },
  };
```

(Add `SettingsRow`, `NewSettingsRow`, `SettingsRepository` to the `@moyasar-ops/db` type import.)

- [ ] **Step 4: Implement `SettingsService`**

`apps/api/src/modules/settings/settings.service.ts`:

```ts
import type { Repositories } from "@moyasar-ops/db";
import type { Mode } from "@moyasar-ops/shared";
import { ValidationError } from "../../errors";
import type { PublicUser } from "../auth/public-user";
import { decryptSecret, encryptSecret } from "./crypto";

export type SettingsView = {
  activeMode: Mode;
  testKeySet: boolean;
  liveKeySet: boolean;
  updatedAt: string;
};

export class SettingsService {
  constructor(
    private readonly repos: Repositories,
    private readonly keyEncryptionKey: string,
  ) {}

  async view(): Promise<SettingsView> {
    const s = await this.repos.settings.get();
    return {
      activeMode: s.activeMode,
      testKeySet: s.moyasarTestKeyEnc !== null,
      liveKeySet: s.moyasarLiveKeyEnc !== null,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async setKey(actor: PublicUser, mode: Mode, key: string, ctx: { ip: string | null }): Promise<void> {
    if (key.trim() === "") throw new ValidationError("API key must not be empty");
    const enc = encryptSecret(key.trim(), this.keyEncryptionKey);
    const column = mode === "test" ? "moyasarTestKeyEnc" : "moyasarLiveKeyEnc";
    await this.repos.transaction(async (r) => {
      await r.settings.update({ [column]: enc, updatedBy: actor.id });
      await r.audit.record({
        actorId: actor.id,
        action: "settings.changed",
        entityType: "settings",
        entityId: "app_settings",
        after: { keyUpdated: mode },
        ip: ctx.ip,
      });
    });
  }

  async setMode(actor: PublicUser, mode: Mode, ctx: { ip: string | null }): Promise<void> {
    await this.repos.transaction(async (r) => {
      const before = await r.settings.get();
      await r.settings.update({ activeMode: mode, updatedBy: actor.id });
      await r.audit.record({
        actorId: actor.id,
        action: "mode.switched",
        entityType: "settings",
        entityId: "app_settings",
        before: { activeMode: before.activeMode },
        after: { activeMode: mode },
        ip: ctx.ip,
      });
    });
  }

  /** Decrypts the secret key for the currently active mode. moyasar module only. */
  async activeSecretKey(): Promise<{ mode: Mode; key: string }> {
    const s = await this.repos.settings.get();
    const enc = s.activeMode === "test" ? s.moyasarTestKeyEnc : s.moyasarLiveKeyEnc;
    if (!enc) {
      throw new ValidationError(`No Moyasar ${s.activeMode} API key is configured`);
    }
    return { mode: s.activeMode, key: decryptSecret(enc, this.keyEncryptionKey) };
  }
}
```

- [ ] **Step 5: Write the failing tests**

`apps/api/test/settings/settings.service.test.ts` (unit, fake repos):

```ts
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import { SettingsService } from "../../src/modules/settings/settings.service";
import type { PublicUser } from "../../src/modules/auth/public-user";
import { FakeRepositories } from "../support/fake-repositories";

const admin: PublicUser = { id: "admin-1", email: "a@x.co", displayName: "A", role: "admin", isActive: true };
const key = randomBytes(32).toString("base64");
const ctx = { ip: "127.0.0.1" };

describe("SettingsService", () => {
  let repos: FakeRepositories;
  let service: SettingsService;
  beforeEach(() => {
    repos = new FakeRepositories();
    service = new SettingsService(repos, key);
  });

  test("view masks keys and reports which are set", async () => {
    let v = await service.view();
    expect(v).toEqual({ activeMode: "test", testKeySet: false, liveKeySet: false, updatedAt: v.updatedAt });
    await service.setKey(admin, "test", "sk_test_123", ctx);
    v = await service.view();
    expect(v.testKeySet).toBe(true);
    expect(v.liveKeySet).toBe(false);
    expect(JSON.stringify(v)).not.toContain("sk_test_123");
  });

  test("setKey stores ciphertext (not plaintext) and audits settings.changed", async () => {
    await service.setKey(admin, "test", "sk_test_123", ctx);
    expect(repos.settingsRow.moyasarTestKeyEnc).not.toBeNull();
    expect(repos.settingsRow.moyasarTestKeyEnc).not.toContain("sk_test_123");
    expect(repos.auditRows.some((a) => a.action === "settings.changed")).toBe(true);
  });

  test("activeSecretKey decrypts the active mode's key; throws if unset", async () => {
    await expect(service.activeSecretKey()).rejects.toThrow(/no moyasar test api key/i);
    await service.setKey(admin, "test", "sk_test_123", ctx);
    expect(await service.activeSecretKey()).toEqual({ mode: "test", key: "sk_test_123" });
  });

  test("setMode switches the active mode and audits mode.switched", async () => {
    await service.setMode(admin, "live", ctx);
    expect(repos.settingsRow.activeMode).toBe("live");
    expect(repos.auditRows.some((a) => a.action === "mode.switched")).toBe(true);
  });
});
```

`packages/db/test/settings-repository.integration.test.ts`:

```ts
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
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun run typecheck && bun run test:unit && DATABASE_URL=postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops bun test packages/db`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/api
git commit -m "feat(api): encrypted settings repository and service (keys + active mode)"
```

---

### Task 3: Settings routes

**Files:**
- Create: `apps/api/src/modules/settings/settings.routes.ts`
- Create: `packages/shared/src/schemas/settings.ts` + export
- Modify: `apps/api/src/container.ts` (add `settings` service), `apps/api/src/app.ts` (mount)
- Test: `apps/api/test/api/settings-flow.integration.test.ts`

**Interfaces:**
- Consumes: `SettingsService`; `requireRole`; `AppEnv`, `clientIp`.
- Produces: `setKeySchema` (`{ mode: "test"|"live", key: string }`), `setModeSchema` (`{ mode: "test"|"live" }`) in shared; `settingsRoutes()` at `/api/v1/settings` (admin only): `GET /` (masked view), `PUT /keys`, `PUT /mode`. `Container` gains `settings: SettingsService`.

- [ ] **Step 1: Shared schemas**

`packages/shared/src/schemas/settings.ts`:

```ts
import { z } from "zod";
import { MODES } from "../enums";

export const setKeySchema = z.object({
  mode: z.enum(MODES),
  key: z.string().min(1).max(500),
});
export type SetKeyInput = z.infer<typeof setKeySchema>;

export const setModeSchema = z.object({ mode: z.enum(MODES) });
export type SetModeInput = z.infer<typeof setModeSchema>;
```

Add `export * from "./schemas/settings";` to `packages/shared/src/index.ts`.

- [ ] **Step 2: Container + service**

In `apps/api/src/container.ts`: import `SettingsService`, add `settings: SettingsService` to `Container`, and construct `const settings = new SettingsService(repos, config.keyEncryptionKey);` — return it in the object.

- [ ] **Step 3: Routes**

`apps/api/src/modules/settings/settings.routes.ts`:

```ts
import { Hono } from "hono";
import { setKeySchema, setModeSchema } from "@moyasar-ops/shared";
import { ValidationError } from "../../errors";
import type { AppEnv } from "../../http-context";
import { clientIp } from "../../http-context";
import { requireRole } from "../../middleware/rbac";

export function settingsRoutes() {
  const app = new Hono<AppEnv>();
  app.use("*", requireRole("admin"));

  app.get("/", async (c) => c.json({ settings: await c.get("container").settings.view() }));

  app.put("/keys", async (c) => {
    const parsed = setKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid key payload", parsed.error.flatten());
    await c
      .get("container")
      .settings.setKey(c.get("user")!, parsed.data.mode, parsed.data.key, { ip: clientIp(c.req.header("x-forwarded-for")) });
    return c.json({ settings: await c.get("container").settings.view() });
  });

  app.put("/mode", async (c) => {
    const parsed = setModeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Invalid mode payload", parsed.error.flatten());
    await c
      .get("container")
      .settings.setMode(c.get("user")!, parsed.data.mode, { ip: clientIp(c.req.header("x-forwarded-for")) });
    return c.json({ settings: await c.get("container").settings.view() });
  });

  return app;
}
```

Mount in `apps/api/src/app.ts`: `import { settingsRoutes } from "./modules/settings/settings.routes";` and `app.route("/api/v1/settings", settingsRoutes());`.

- [ ] **Step 4: API integration test**

`apps/api/test/api/settings-flow.integration.test.ts` — seed an admin + a viewer, log in, assert: GET /settings returns masked view; PUT /keys with the CSRF header sets a key (view shows `testKeySet: true`, body never contains the plaintext); PUT /mode switches mode; a viewer gets 403. (Follow the exact login/cookie/CSRF helper pattern from `apps/api/test/api/batches-flow.integration.test.ts`, and remember `loadConfig` env now needs `KEY_ENCRYPTION_KEY`.) Clean up sessions (not audit_logs). Full code mirrors the batches-flow test structure; assert the plaintext key never appears in any response body.

- [ ] **Step 5: Run + commit**

Run: `bun run typecheck && bun run test:unit && DATABASE_URL=…5433… bun test apps/api/test/api`
Expected: PASS.

```bash
git add apps/api packages/shared
git commit -m "feat(api): admin settings routes (masked view, set keys, switch mode)"
```

---

### Task 4: Moyasar client

**Files:**
- Create: `apps/api/src/modules/moyasar/moyasar-types.ts`
- Create: `apps/api/src/modules/moyasar/moyasar-client.ts`
- Test: `apps/api/test/moyasar/moyasar-client.test.ts`

**Interfaces:**
- Consumes: `MoyasarApiError` from `errors.ts`; a `fetch`-like function (injected for tests).
- Produces:
  - Zod schemas + types: `moyasarInvoiceSchema` (`{ id, status, amount, currency, description, url, metadata }`), `MoyasarInvoice`.
  - `type BulkInvoiceInput = { amount: number; currency: string; description: string; expired_at?: string; success_url?: string; back_url?: string; callback_url?: string; metadata: Record<string,string> }`.
  - `class MoyasarClient` constructed with `{ baseUrl: string; secretKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }`, methods:
    - `createBulk(invoices: BulkInvoiceInput[]): Promise<MoyasarInvoice[]>` — POST `/invoices/bulk`; ≤50 enforced (throws if >50); never retried; on network/5xx/timeout throws `MoyasarApiError` tagged `ambiguous: true`; on 4xx throws `MoyasarApiError` tagged `ambiguous: false` (definitive validation failure) with the parsed error body.
    - `listByBatch(platformBatchId: string, page: number): Promise<{ invoices: MoyasarInvoice[]; nextPage: number | null }>` — GET `/invoices?metadata[platform_batch_id]=…&page=…`; idempotent, retried on 429/5xx with jittered backoff.
- `MoyasarApiError` gains an `ambiguous` flag (extend it in `errors.ts`: add `constructor(message, detail?, readonly ambiguous = false)`).

- [ ] **Step 1: Extend `MoyasarApiError`**

In `apps/api/src/errors.ts`, replace the `MoyasarApiError` class with:

```ts
export class MoyasarApiError extends AppError {
  readonly status = 502;
  readonly type = "moyasar_api_error";
  constructor(
    message: string,
    detail?: unknown,
    readonly ambiguous = false,
  ) {
    super(message, detail);
  }
}
```

(The base `AppError` constructor is `(message, detail?)`; this adds the third field. Existing throw sites `new MoyasarApiError(msg)` / `new MoyasarApiError(msg, detail)` keep working.)

- [ ] **Step 2: Types**

`apps/api/src/modules/moyasar/moyasar-types.ts`:

```ts
import { z } from "zod";

export const moyasarInvoiceSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number(),
  currency: z.string(),
  description: z.string(),
  url: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.string()).optional().nullable(),
});
export type MoyasarInvoice = z.infer<typeof moyasarInvoiceSchema>;

export const bulkResponseSchema = z.object({ invoices: z.array(moyasarInvoiceSchema) });
export const listResponseSchema = z.object({
  invoices: z.array(moyasarInvoiceSchema),
  meta: z.object({ current_page: z.number(), next_page: z.number().nullable() }).optional(),
});

export type BulkInvoiceInput = {
  amount: number;
  currency: string;
  description: string;
  expired_at?: string;
  success_url?: string;
  back_url?: string;
  callback_url?: string;
  metadata: Record<string, string>;
};
```

- [ ] **Step 3: Write the failing client tests**

`apps/api/test/moyasar/moyasar-client.test.ts` — build the client with an injected `fetchImpl` that returns canned `Response`s. Cover: (a) `createBulk` posts to `<base>/invoices/bulk` with a Basic auth header derived from the secret key and returns the parsed `invoices`; (b) `createBulk` throws if given >50 invoices without calling fetch; (c) a 400 response makes `createBulk` throw `MoyasarApiError` with `ambiguous === false` and the parsed error detail; (d) a 500 (and a thrown network error / timeout) make `createBulk` throw with `ambiguous === true` and DO NOT retry (fetch called once); (e) `listByBatch` retries a 500 then succeeds (fetch called twice) and returns `nextPage` from `meta.next_page`; (f) the auth header equals `Basic ` + base64(`<key>:`).

```ts
import { describe, expect, test } from "bun:test";
import { MoyasarClient } from "../../src/modules/moyasar/moyasar-client";
import { MoyasarApiError } from "../../src/errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const invoice = (id: string, meta: Record<string, string>) => ({
  id, status: "initiated", amount: 14999, currency: "SAR", description: "x", url: `https://pay/${id}`, metadata: meta,
});

test("createBulk posts with Basic auth and returns parsed invoices", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return jsonResponse({ invoices: [invoice("inv_1", { platform_item_id: "a" })] });
  }) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://api.moyasar.com/v1", secretKey: "sk_test_x", fetchImpl });
  const out = await client.createBulk([
    { amount: 14999, currency: "SAR", description: "x", metadata: { platform_item_id: "a", platform_batch_id: "b" } },
  ]);
  expect(out[0]!.id).toBe("inv_1");
  expect(seen!.url).toBe("https://api.moyasar.com/v1/invoices/bulk");
  expect((seen!.init.headers as Record<string, string>).Authorization).toBe(
    `Basic ${Buffer.from("sk_test_x:").toString("base64")}`,
  );
});

test("createBulk rejects >50 invoices without calling fetch", async () => {
  let called = 0;
  const fetchImpl = (async () => { called++; return jsonResponse({ invoices: [] }); }) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://b", secretKey: "k", fetchImpl });
  const many = Array.from({ length: 51 }, () => ({ amount: 100, currency: "SAR", description: "x", metadata: {} }));
  await expect(client.createBulk(many)).rejects.toThrow(/50/);
  expect(called).toBe(0);
});

test("a 400 is a definitive (non-ambiguous) MoyasarApiError", async () => {
  const fetchImpl = (async () => jsonResponse({ message: "amount too small", errors: { amount: ["min"] } }, 400)) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://b", secretKey: "k", fetchImpl });
  try {
    await client.createBulk([{ amount: 1, currency: "SAR", description: "x", metadata: {} }]);
    throw new Error("should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(MoyasarApiError);
    expect((e as MoyasarApiError).ambiguous).toBe(false);
  }
});

test("a 500 is an ambiguous MoyasarApiError and is not retried by createBulk", async () => {
  let called = 0;
  const fetchImpl = (async () => { called++; return jsonResponse({ message: "boom" }, 500); }) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://b", secretKey: "k", fetchImpl });
  await expect(client.createBulk([{ amount: 100, currency: "SAR", description: "x", metadata: {} }])).rejects.toMatchObject({ ambiguous: true });
  expect(called).toBe(1);
});

test("listByBatch retries a 500 then succeeds and reports nextPage", async () => {
  let called = 0;
  const fetchImpl = (async () => {
    called++;
    if (called === 1) return jsonResponse({ message: "boom" }, 500);
    return jsonResponse({ invoices: [invoice("inv_9", { platform_batch_id: "b" })], meta: { current_page: 1, next_page: 2 } });
  }) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://b", secretKey: "k", fetchImpl, retryBaseMs: 1 });
  const res = await client.listByBatch("b", 1);
  expect(called).toBe(2);
  expect(res.invoices[0]!.id).toBe("inv_9");
  expect(res.nextPage).toBe(2);
});
```

- [ ] **Step 4: Implement the client**

`apps/api/src/modules/moyasar/moyasar-client.ts`:

```ts
import { MoyasarApiError } from "../../errors";
import { bulkResponseSchema, type BulkInvoiceInput, listResponseSchema, type MoyasarInvoice } from "./moyasar-types";

type Options = {
  baseUrl: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryBaseMs?: number;
  maxRetries?: number;
};

export class MoyasarClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly maxRetries: number;

  constructor(opts: Options) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.authHeader = `Basic ${Buffer.from(`${opts.secretKey}:`).toString("base64")}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retryBaseMs = opts.retryBaseMs ?? 300;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: this.authHeader, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async createBulk(invoices: BulkInvoiceInput[]): Promise<MoyasarInvoice[]> {
    if (invoices.length > 50) {
      throw new MoyasarApiError(`Bulk create accepts at most 50 invoices (got ${invoices.length})`);
    }
    let res: Response;
    try {
      res = await this.raw("/invoices/bulk", { method: "POST", body: JSON.stringify({ invoices }) });
    } catch (e) {
      // network error / timeout — ambiguous: the request may have reached Moyasar.
      throw new MoyasarApiError(`Moyasar bulk create failed: ${String(e)}`, undefined, true);
    }
    if (res.ok) {
      const parsed = bulkResponseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new MoyasarApiError("Unexpected Moyasar bulk response shape", parsed.error?.flatten(), true);
      return parsed.data.invoices;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status >= 500) {
      throw new MoyasarApiError(`Moyasar bulk create ${res.status}`, body, true);
    }
    throw new MoyasarApiError(`Moyasar bulk create rejected (${res.status})`, body, false);
  }

  async listByBatch(platformBatchId: string, page: number): Promise<{ invoices: MoyasarInvoice[]; nextPage: number | null }> {
    const path = `/invoices?metadata[platform_batch_id]=${encodeURIComponent(platformBatchId)}&page=${page}`;
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.raw(path, { method: "GET" });
      } catch (e) {
        if (attempt++ >= this.maxRetries) throw new MoyasarApiError(`Moyasar list failed: ${String(e)}`, undefined, true);
        await this.backoff(attempt);
        continue;
      }
      if (res.ok) {
        const parsed = listResponseSchema.safeParse(await res.json().catch(() => null));
        if (!parsed.success) throw new MoyasarApiError("Unexpected Moyasar list response shape", parsed.error?.flatten(), true);
        return { invoices: parsed.data.invoices, nextPage: parsed.data.meta?.next_page ?? null };
      }
      if ((res.status === 429 || res.status >= 500) && attempt++ < this.maxRetries) {
        await this.backoff(attempt);
        continue;
      }
      const body = await res.json().catch(() => ({}));
      throw new MoyasarApiError(`Moyasar list ${res.status}`, body, res.status >= 500);
    }
  }

  private backoff(attempt: number): Promise<void> {
    const jitter = Math.random() * this.retryBaseMs;
    return new Promise((resolve) => setTimeout(resolve, this.retryBaseMs * 2 ** (attempt - 1) + jitter));
  }
}
```

- [ ] **Step 5: Run + commit**

Run: `bun run typecheck && bun test apps/api/test/moyasar`
Expected: PASS.

```bash
git add apps/api
git commit -m "feat(api): typed Moyasar client (bulk create, list-by-metadata, retry policy)"
```

---

### Task 5: Jobs repository + claim with `FOR UPDATE SKIP LOCKED`

**Files:**
- Create: `packages/db/src/repositories/jobs.repository.ts`
- Modify: `packages/db/src/repositories/types.ts`, `.../index.ts`
- Modify: `apps/api/test/support/fake-repositories.ts`
- Test: `packages/db/test/jobs-repository.integration.test.ts`

**Interfaces:**
- Produces:
  - `type JobRow = typeof jobs.$inferSelect`.
  - `interface JobsRepository { enqueue(type: "submit_batch" | "sync_invoices", payload: Record<string, unknown>): Promise<JobRow>; claimNext(workerId: string): Promise<JobRow | null>; complete(id: string): Promise<void>; fail(id: string, error: string, retryInMs: number | null): Promise<void>; listDead(): Promise<JobRow[]> }`.
  - `Repositories` gains `jobs: JobsRepository`.
- `claimNext` uses `UPDATE jobs SET status='running', locked_at=now(), locked_by=$1, attempts=attempts+1 WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_at <= now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`. `fail` sets `status='failed'` with `run_at = now()+retry` and back to `pending` when `retryInMs !== null` and `attempts < max_attempts`; otherwise leaves it `failed` (dead).

- [ ] **Step 1: types.ts** — add `jobs` to the schema import, `JobRow` type, the `JobsRepository` interface, and `jobs: JobsRepository` on `Repositories`.

- [ ] **Step 2: Implement** `packages/db/src/repositories/jobs.repository.ts`:

```ts
import { and, eq, lte, sql } from "drizzle-orm";
import { jobs } from "../schema";
import type { Executor, JobRow, JobsRepository } from "./types";

export class DrizzleJobsRepository implements JobsRepository {
  constructor(private readonly db: Executor) {}

  async enqueue(type: "submit_batch" | "sync_invoices", payload: Record<string, unknown>): Promise<JobRow> {
    const [row] = await this.db.insert(jobs).values({ type, payload }).returning();
    return row!;
  }

  async claimNext(workerId: string): Promise<JobRow | null> {
    const result = await this.db.execute(sql`
      UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending' AND run_at <= now()
        ORDER BY run_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `);
    const rows = result as unknown as JobRow[];
    return rows[0] ?? null;
  }

  async complete(id: string): Promise<void> {
    await this.db.update(jobs).set({ status: "done", lockedAt: null, lockedBy: null }).where(eq(jobs.id, id));
  }

  async fail(id: string, error: string, retryInMs: number | null): Promise<void> {
    if (retryInMs === null) {
      await this.db.update(jobs).set({ status: "failed", lastError: error, lockedAt: null, lockedBy: null }).where(eq(jobs.id, id));
      return;
    }
    await this.db
      .update(jobs)
      .set({
        status: "pending",
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        runAt: sql`now() + (${retryInMs} || ' milliseconds')::interval`,
      })
      .where(eq(jobs.id, id));
  }

  async listDead(): Promise<JobRow[]> {
    return this.db.select().from(jobs).where(and(eq(jobs.status, "failed")));
  }
}
```

- [ ] **Step 3: Wire into `build`; extend the fake** with an in-memory `jobs` array and a `claimNext` that pops the oldest `pending` job whose `runAt <= now`, marking it `running` and incrementing `attempts` (single-threaded, so no real locking needed).

- [ ] **Step 4: Integration test** `packages/db/test/jobs-repository.integration.test.ts`: enqueue two jobs; `claimNext("w1")` returns the older one with `status='running'`, `attempts=1`; a concurrent `claimNext("w2")` returns the second (proves `SKIP LOCKED` doesn't hand the same row twice when run sequentially — enqueue 2, claim 2 distinct ids, a 3rd claim returns null); `complete` marks it `done`; `fail(id, "e", 50)` re-queues it `pending` with a future `run_at`; `fail(id, "e", null)` marks it dead (`failed`) and `listDead` includes it. Clean up the created rows.

- [ ] **Step 5: Run + commit**

Run: `bun run typecheck && bun run test:unit && DATABASE_URL=…5433… bun test packages/db`

```bash
git add packages/db apps/api/test/support/fake-repositories.ts
git commit -m "feat(db): jobs repository with FOR UPDATE SKIP LOCKED claim"
```

---

### Task 6: Job runner

**Files:**
- Create: `apps/api/src/jobs/job-runner.ts`
- Test: `apps/api/test/jobs/job-runner.test.ts`

**Interfaces:**
- Consumes: `Repositories` (`jobs`), a `handlers` map.
- Produces: `type JobHandler = (payload: Record<string, unknown>) => Promise<void>`; `class JobRunner` with `constructor(repos, handlers: Record<string, JobHandler>, opts: { workerId: string; pollIntervalMs: number; maxAttempts?: number })`, `runOnce(): Promise<boolean>` (claims and runs one job; returns whether one ran), `start()`/`stop()` (the poll loop). On handler success → `complete`; on throw → `fail(id, err, backoff)` if `attempts < maxAttempts` else `fail(id, err, null)` (dead).

- [ ] **Step 1: Write the failing tests** (unit, fake repos): a handler that succeeds marks the job `done`; a handler that throws re-queues the job with a future `run_at` while attempts remain, and marks it dead after `maxAttempts`; `runOnce` returns `false` when no job is claimable; an unknown job `type` is failed with a clear error. Use the fake `jobs` repo and a controllable clock/backoff (pass `backoffMs = () => 0`).

- [ ] **Step 2: Implement** `job-runner.ts` — `runOnce` claims via `repos.jobs.claimNext(workerId)`, looks up `handlers[job.type]`, runs it, and on error computes retry (`attempts >= maxAttempts ? null : backoffMs(attempts)`). `start()` loops calling `runOnce`; when it returns false, `await sleep(pollIntervalMs)`; `stop()` flips a flag and awaits the loop. Structured `console`-level logging of claim/success/failure with the job id (pino comes in the Plan-2 carried-forward observability work; keep a single log site).

- [ ] **Step 3: Run + commit**

```bash
git add apps/api
git commit -m "feat(api): in-process job runner with retry/backoff and dead-job handling"
```

---

### Task 7: Submission engine (`submit_batch` handler) + reconciliation

**Files:**
- Create: `apps/api/src/modules/moyasar/submission-engine.ts`
- Modify: `packages/db/src/repositories/items.repository.ts` + interface (add `updateSubmission` + `findBySubmitting`/`markStatus` helpers as needed)
- Test: `apps/api/test/moyasar/submission-engine.test.ts`

**Interfaces:**
- Consumes: `Repositories`, `MoyasarClient` (or a minimal `SubmissionClient` interface it depends on, so tests inject a fake), `SettingsService.activeSecretKey`.
- Produces:
  - `interface SubmissionClient { createBulk(invoices: BulkInvoiceInput[]): Promise<MoyasarInvoice[]>; listByBatch(id: string, page: number): Promise<{ invoices: MoyasarInvoice[]; nextPage: number | null }> }` (both `MoyasarClient` and the test fake implement it).
  - `class SubmissionEngine` with `submitBatch(batchId: string): Promise<void>` — the `submit_batch` job handler body.
  - `ItemsRepository` gains: `markSubmitting(itemIds: string[]): Promise<void>`, `recordSubmitted(itemId: string, moyasar: { id: string; url: string | null; status: string }): Promise<void>`, `recordFailed(itemId: string, error: string): Promise<void>`, and `listByBatchAndStatus(batchId, status): Promise<ItemRow[]>`.

**Engine algorithm (spec §7.2–7.3):**
1. Load the batch; if not `approved` (or `submitting` after a crash), and already `submitted`, return (idempotent). Set batch `submitting`.
2. Load `valid` items (and any left `submitting` from a prior crash). Build a map by item id.
3. **Reconcile first** (always, before sending): page `client.listByBatch(batchId)`; for every returned invoice whose `metadata.platform_item_id` matches a local item still `valid`/`submitting`, heal it to `submitted` with the Moyasar id/url/status. This makes retries safe.
4. Collect items still needing creation (status `valid`, no `moyasarInvoiceId`). Chunk ≤50. For each chunk: `markSubmitting(ids)` (persist before the call); `createBulk(chunkInputs)`; match results back by `metadata.platform_item_id`, `recordSubmitted` each; any local item in the chunk not present in the response → leave `submitting` for the next reconcile pass.
5. On a definitive 4xx (`ambiguous === false`): `recordFailed` each item in that chunk with the Moyasar error. On an ambiguous error (`ambiguous === true`): stop the chunk loop and rethrow so the job retries — the next run reconciles and heals whatever actually got created.
6. After all chunks: recompute — if every item is `submitted`, batch → `submitted` (`completedAt` set); if a mix of `submitted`/`failed`, batch → `partially_failed`; audit `batch.submission_started` at the top and `item.submitted`/`item.failed` are implicit in item rows (record a single `batch.submitted`/`batch.partially_failed` audit at the end).

- [ ] **Step 1: Add the item repo methods** (Drizzle + fake + interface). `markSubmitting` sets `status='submitting'` for the ids; `recordSubmitted` sets `status='submitted'`, `moyasarInvoiceId`, `moyasarUrl`, `moyasarStatus`, `lastSyncedAt=now()`; `recordFailed` sets `status='failed'`, `validationErrors={ submission: [error] }`.

- [ ] **Step 2: Write the failing engine tests** (unit, fake repos + fake `SubmissionClient`):
  - happy path: 3 valid items → one `createBulk` call → all `submitted`, batch `submitted`.
  - chunking: 120 valid items → 3 `createBulk` calls of 50/50/20.
  - definitive 4xx on a chunk → those items `failed`, batch `partially_failed`.
  - **crash recovery / idempotency:** pre-seed the fake client's `listByBatch` to already contain an invoice for item A (as if a prior run created it), plus item B not yet created; run `submitBatch` → item A is healed to `submitted` via reconciliation (its input is NOT re-sent — assert the fake client's `createBulk` received only B), item B is created.
  - ambiguous error (`ambiguous:true`) mid-run → `submitBatch` rethrows (so the job retries); items remain `submitting`, batch stays `submitting`.

- [ ] **Step 3: Implement** `submission-engine.ts` per the algorithm above. The engine takes `{ repos, client, settings }`; the job handler wired in Task 8 constructs the real `MoyasarClient` from `settings.activeSecretKey()` + `config.moyasarBaseUrl` per run (so a mode/key change is picked up on the next job).

- [ ] **Step 4: Run + commit**

```bash
git add apps/api packages/db
git commit -m "feat(api): submission engine with 50-chunk bulk create and metadata reconciliation"
```

---

### Task 8: Wire approval → job, mode from settings, runner start, and an end-to-end test

**Files:**
- Modify: `apps/api/src/modules/batches/batches.service.ts` (`approve()`)
- Modify: `apps/api/src/container.ts` (build the submission handler + runner; inject an `enqueueSubmit` into `BatchesService`)
- Modify: `apps/api/src/index.ts` (start the runner)
- Test: `apps/api/test/api/submission-flow.integration.test.ts`

**Interfaces:**
- `BatchesService` constructor gains an optional `enqueue?: (batchId: string) => Promise<void>` (defaulting to a no-op so existing unit tests keep passing) OR takes the `jobs` repo via `repos`. Use `repos.jobs.enqueue("submit_batch", { batchId })` inside `approve()`'s transaction.
- `approve()` reads the active mode from `settings` and snapshots it on the batch (replacing `mode: "test"`), then enqueues the submit job — both inside the same transaction as the status update and audit.

- [ ] **Step 1: Update `approve()`** — inject `SettingsService` (or read `repos.settings.get()`), replace the hardcoded `mode: "test"` with the settings' `activeMode`, and after the conditional status update + audit, `await r.jobs.enqueue("submit_batch", { batchId: id })` inside the same transaction. Update the maker-checker unit tests that asserted `mode` is non-null — they still pass (mode is `test` by default from the fake settings row), and add an assertion that a `submit_batch` job was enqueued (the fake `jobs` repo has a row after approve).

- [ ] **Step 2: Container** — construct the `SubmissionEngine`, a `handlers` map `{ submit_batch: (p) => engine.submitBatch(p.batchId as string) }`, and a `JobRunner`. Add `runner` to the container. The engine builds a `MoyasarClient` per run from `settings.activeSecretKey()` + `config.moyasarBaseUrl`.

- [ ] **Step 3: index.ts** — after building the container, `container.runner.start()`; on `SIGTERM`/`SIGINT` call `container.runner.stop()` then exit.

- [ ] **Step 4: End-to-end integration test** `submission-flow.integration.test.ts` — this is the capstone. Build the container with a **mock Moyasar** via a `fetchImpl` injected into the client (thread an optional `moyasarFetch` through `createContainer` for tests, defaulting to global `fetch`). Seed an admin key so `activeSecretKey()` works. Flow: maker creates a batch, fills 2 valid items, submits; approver approves (enqueues the job); call `container.runner.runOnce()`; assert both items are `submitted` with `moyasarInvoiceId` set and the batch is `submitted`. Second scenario: the mock returns a 400 for the chunk → items `failed`, batch `partially_failed`. Clean up (sessions/batches/items; not audit_logs).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `bun run typecheck && bun run test:unit && DATABASE_URL=…5433… bun test`
Expected: all pass, including the end-to-end submission test driven by the mock Moyasar `fetch`.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): approval enqueues submission, snapshots active mode, runner starts on boot"
```

---

## Verification (whole plan)

- [ ] `bun run typecheck` — clean across all three workspaces
- [ ] `bun run test:unit` — passes with NO database (crypto, client vs mock fetch, engine vs fake client, runner, settings service)
- [ ] `docker compose up -d postgres` then `DATABASE_URL=…5433… bun test` — all integration + API tests pass, including the end-to-end submission flow against a mock Moyasar `fetch`
- [ ] Manual: set a test key via `PUT /settings/keys`, approve a batch, watch the runner create invoices; kill the process mid-submit and restart → reconciliation heals without duplicates (verify by counting invoices for the batch's metadata)
- [ ] No real Moyasar network call occurs in any test
- [ ] `git log --oneline` shows one commit per task (8 commits)

## Notes carried forward to Plan 5 (status sync)

- Plan 5 adds the recurring `sync_invoices` job: list local items whose `moyasarStatus` is `initiated`, query Moyasar (`created[gt]` windows + `metadata[platform_batch_id]`), and update `moyasarStatus`/`lastSyncedAt` — the only mechanism that detects `paid`/`expired`/`canceled`. A per-invoice/per-batch "refresh now" hits the same code.
- Plan 5 adds cancel (`PUT /invoices/:id/cancel`) for a still-`initiated` invoice (admin/approver), with audit `invoice.canceled`.
- The submission engine's `recordFailed` writes `validationErrors.submission`; `cloneFailed` (Plan 3) already clones `failed` items, so the "retry failed submissions in a new batch" flow works once real `failed` items exist.
- Webhook receiver remains deferred; when added it verifies the `webhookSecretEnc` (already in `app_settings`) and dedups on event identity.
- Carried from Plan 2/3 (still open): trusted-proxy gate for `X-Forwarded-For`; pino + request-id logging (the job runner adds another log site — fold it into that work); the runner + rate limiter are per-process (single-instance) — revisit on horizontal scale.
