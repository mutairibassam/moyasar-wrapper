import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, createRepositories, invoiceBatches, invoiceItems, jobs, sessions } from "@moyasar-ops/db";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { createContainer } from "../../src/container";
import { hashPassword } from "../../src/modules/auth/password";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const baseConfig = {
  ...loadConfig({
    DATABASE_URL: url,
    KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  } as NodeJS.ProcessEnv),
  cookieSecure: false,
};

const stamp = Date.now();
const ids: string[] = [];

async function seed(email: string, role: "maker" | "approver" | "admin") {
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

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "a-strong-password" }),
  });
  return jar(res.headers.getSetCookie());
}

/** Mock Moyasar `fetch`: bulk-create succeeds (201) or is rejected (400), list is always empty. */
function makeMockFetch(bulkStatus: 201 | 400): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (method === "POST" && url.endsWith("/invoices/bulk")) {
      if (bulkStatus === 400) {
        return new Response(JSON.stringify({ message: "bad" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as { invoices: Record<string, unknown>[] };
      const invoices = body.invoices.map((inv, i) => ({
        id: `inv_${i}_${Date.now()}`,
        status: "initiated",
        amount: inv.amount,
        currency: inv.currency,
        description: inv.description,
        url: `https://pay/${i}`,
        metadata: inv.metadata,
      }));
      return new Response(JSON.stringify({ invoices }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "GET" && url.includes("/invoices?")) {
      return new Response(
        JSON.stringify({ invoices: [], meta: { current_page: 1, next_page: null } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected mock fetch call: ${method} ${url}`);
  }) as typeof fetch;
}

async function seedTestKey(): Promise<void> {
  const repos = createRepositories(db);
  const admin = await repos.users.create({
    email: `sub-key-admin-${stamp}@example.com`,
    passwordHash: await hashPassword("a-strong-password"),
    displayName: "key admin",
    role: "admin",
  });
  ids.push(admin.id);
  const settingsModule = await import("../../src/modules/settings/settings.service");
  const settings = new settingsModule.SettingsService(repos, baseConfig.keyEncryptionKey);
  const adminPublic = { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role, isActive: true };
  await settings.setKey(adminPublic, "test", `sk_test_${stamp}_mockkey`, { ip: null });
}

async function makerApproverFlow(
  app: ReturnType<typeof createApp>,
  makerEmail: string,
  approverEmail: string,
): Promise<string> {
  const maker = await login(app, makerEmail);
  const approver = await login(app, approverEmail);

  const created = await app.request("/api/v1/batches", {
    method: "POST",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ name: "Submission flow batch", currency: "SAR" }),
  });
  expect(created.status).toBe(201);
  const batchId = (await created.json()).batch.id as string;

  const filled = await app.request(`/api/v1/batches/${batchId}/items`, {
    method: "PATCH",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({
      items: [
        { amount: 10000, currency: "SAR", description: "Item A" },
        { amount: 20000, currency: "SAR", description: "Item B" },
      ],
    }),
  });
  expect(filled.status).toBe(200);

  const submitted = await app.request(`/api/v1/batches/${batchId}/submit-for-approval`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
  });
  expect(submitted.status).toBe(200);

  const approved = await app.request(`/api/v1/batches/${batchId}/approve`, {
    method: "POST",
    headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf },
  });
  expect(approved.status).toBe(200);
  expect((await approved.json()).batch.status).toBe("approved");

  return batchId;
}

describe("submission flow (approve -> enqueue -> runner -> engine, mock Moyasar)", () => {
  beforeAll(async () => {
    await seedTestKey();
  });

  test("happy path: bulk create succeeds -> items submitted, batch submitted", async () => {
    const makerEmail = `sub-maker-ok-${stamp}@example.com`;
    const approverEmail = `sub-approver-ok-${stamp}@example.com`;
    await seed(makerEmail, "maker");
    await seed(approverEmail, "approver");

    const container = createContainer(db, baseConfig, makeMockFetch(201));
    const app = createApp(container);

    const batchId = await makerApproverFlow(app, makerEmail, approverEmail);

    const ran = await container.runner.runOnce();
    expect(ran).toBe(true);

    const view = await app.request(`/api/v1/batches/${batchId}`, {
      headers: { cookie: (await login(app, makerEmail)).cookie },
    });
    const body = await view.json();
    expect(body.batch.status).toBe("submitted");
    expect(body.batch.items).toHaveLength(2);
    for (const item of body.batch.items) {
      expect(item.status).toBe("submitted");
      expect(item.moyasarInvoiceId).not.toBeNull();
    }
  });

  test("bulk create rejected (400): items failed, batch partially_failed", async () => {
    const makerEmail = `sub-maker-fail-${stamp}@example.com`;
    const approverEmail = `sub-approver-fail-${stamp}@example.com`;
    await seed(makerEmail, "maker");
    await seed(approverEmail, "approver");

    const container = createContainer(db, baseConfig, makeMockFetch(400));
    const app = createApp(container);

    const batchId = await makerApproverFlow(app, makerEmail, approverEmail);

    const ran = await container.runner.runOnce();
    expect(ran).toBe(true);

    const view = await app.request(`/api/v1/batches/${batchId}`, {
      headers: { cookie: (await login(app, makerEmail)).cookie },
    });
    const body = await view.json();
    expect(body.batch.status).toBe("partially_failed");
    for (const item of body.batch.items) {
      expect(item.status).toBe("failed");
    }
  });
});

afterAll(async () => {
  const bIds = (await db.select({ id: invoiceBatches.id }).from(invoiceBatches).where(inArray(invoiceBatches.createdBy, ids))).map((r) => r.id);
  if (bIds.length > 0) {
    const jobRows = await db.select({ id: jobs.id, payload: jobs.payload }).from(jobs);
    const jobIds = jobRows
      .filter((j) => bIds.includes((j.payload as { batchId?: string }).batchId ?? ""))
      .map((j) => j.id);
    if (jobIds.length > 0) {
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }
    await db.delete(invoiceItems).where(inArray(invoiceItems.batchId, bIds));
    await db.delete(invoiceBatches).where(inArray(invoiceBatches.id, bIds));
  }
  for (const id of ids) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    // audit_logs is append-only (trigger) — cannot delete; harmless test rows remain.
  }
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
