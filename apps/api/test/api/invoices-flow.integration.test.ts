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

type MockInvoice = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  url: string;
  metadata: Record<string, string>;
};

/**
 * Stateful mock Moyasar `fetch`:
 * - POST /invoices/bulk: creates an "initiated" invoice per input item, remembered by id.
 * - GET /invoices?metadata[platform_batch_id]=...: lists remembered invoices for that batch.
 * - PUT /invoices/:id/cancel: flips the invoice to "canceled" and returns it.
 */
function makeMockFetch(store: Map<string, MockInvoice>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (method === "POST" && rawUrl.endsWith("/invoices/bulk")) {
      const body = JSON.parse(String(init?.body)) as { invoices: Record<string, unknown>[] };
      const invoices: MockInvoice[] = body.invoices.map((inv, i) => {
        const invoice: MockInvoice = {
          id: `inv_${stamp}_${store.size + i}`,
          status: "initiated",
          amount: inv.amount as number,
          currency: inv.currency as string,
          description: inv.description as string,
          url: `https://pay/${i}`,
          metadata: inv.metadata as Record<string, string>,
        };
        store.set(invoice.id, invoice);
        return invoice;
      });
      return new Response(JSON.stringify({ invoices }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "GET" && rawUrl.includes("/invoices?")) {
      const parsed = new URL(rawUrl);
      const batchId = parsed.searchParams.get("metadata[platform_batch_id]");
      const invoices = [...store.values()].filter((inv) => batchId === null || inv.metadata.platform_batch_id === batchId);
      return new Response(
        JSON.stringify({ invoices, meta: { current_page: 1, next_page: null } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (method === "PUT" && rawUrl.includes("/cancel")) {
      const id = rawUrl.split("/invoices/")[1]!.split("/cancel")[0]!;
      const invoice = store.get(id);
      if (!invoice) {
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      invoice.status = "canceled";
      store.set(id, invoice);
      return new Response(JSON.stringify(invoice), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected mock fetch call: ${method} ${rawUrl}`);
  }) as typeof fetch;
}

async function seedTestKey(): Promise<void> {
  const repos = createRepositories(db);
  const admin = await repos.users.create({
    email: `inv-key-admin-${stamp}@example.com`,
    passwordHash: await hashPassword("a-strong-password"),
    displayName: "key admin",
    role: "admin",
  });
  ids.push(admin.id);
  const settingsModule = await import("../../src/modules/settings/settings.service");
  const settings = new settingsModule.SettingsService(repos, baseConfig.keyEncryptionKey);
  const adminPublic = { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role, isActive: true };
  await settings.setKey(adminPublic, "test", `sk_test_${stamp}_invkey`, { ip: null });
}

async function makerApproverSubmitFlow(
  app: ReturnType<typeof createApp>,
  container: ReturnType<typeof createContainer>,
  makerEmail: string,
  approverEmail: string,
): Promise<string> {
  const maker = await login(app, makerEmail);
  const approver = await login(app, approverEmail);

  const created = await app.request("/api/v1/batches", {
    method: "POST",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ name: "Invoices flow batch", currency: "SAR" }),
  });
  expect(created.status).toBe(201);
  const batchId = (await created.json()).batch.id as string;

  const filled = await app.request(`/api/v1/batches/${batchId}/items`, {
    method: "PATCH",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({
      items: [
        { amount: 10000, currency: "SAR", description: "Invoice A" },
        { amount: 20000, currency: "SAR", description: "Invoice B" },
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

  const ran = await container.runner.runOnce();
  expect(ran).toBe(true);

  const view = await app.request(`/api/v1/batches/${batchId}`, { headers: { cookie: maker.cookie } });
  const body = await view.json();
  expect(body.batch.status).toBe("submitted");
  for (const item of body.batch.items) {
    expect(item.status).toBe("submitted");
    expect(item.moyasarStatus).toBe("initiated");
  }

  return batchId;
}

describe("invoices explorer, cancel, and per-batch refresh (mock Moyasar)", () => {
  const store = new Map<string, MockInvoice>();
  let container: ReturnType<typeof createContainer>;
  let app: ReturnType<typeof createApp>;
  let batchId: string;
  let makerEmail: string;
  let approverEmail: string;

  beforeAll(async () => {
    await seedTestKey();
    makerEmail = `inv-maker-${stamp}@example.com`;
    approverEmail = `inv-approver-${stamp}@example.com`;
    await seed(makerEmail, "maker");
    await seed(approverEmail, "approver");

    container = createContainer(db, baseConfig, makeMockFetch(store));
    app = createApp(container);

    batchId = await makerApproverSubmitFlow(app, container, makerEmail, approverEmail);
  });

  test("refresh reconciles a paid invoice and it shows in the explorer", async () => {
    const maker = await login(app, makerEmail);

    // Flip one of the two mock invoices to "paid" (simulating an upstream status change).
    const batchInvoices = [...store.values()].filter((inv) => inv.metadata.platform_batch_id === batchId);
    expect(batchInvoices.length).toBe(2);
    batchInvoices[0]!.status = "paid";

    const refreshed = await app.request(`/api/v1/batches/${batchId}/refresh`, {
      method: "POST",
      headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual({ updated: 1 });

    const paidList = await app.request("/api/v1/invoices?status=paid", {
      headers: { cookie: maker.cookie },
    });
    expect(paidList.status).toBe(200);
    const paidBody = await paidList.json();
    expect(paidBody.items.length).toBe(1);
    expect(paidBody.items[0].moyasarInvoiceId).toBe(batchInvoices[0]!.id);
    expect(paidBody.items[0].moyasarStatus).toBe("paid");
  });

  test("approver cancels a still-initiated invoice; a second cancel conflicts", async () => {
    const approver = await login(app, approverEmail);

    const stillInitiated = [...store.values()].find(
      (inv) => inv.metadata.platform_batch_id === batchId && inv.status === "initiated",
    );
    expect(stillInitiated).toBeDefined();

    const canceled = await app.request(`/api/v1/invoices/${stillInitiated!.id}/cancel`, {
      method: "POST",
      headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf },
    });
    expect(canceled.status).toBe(200);
    const canceledBody = await canceled.json();
    expect(canceledBody.invoice.moyasarStatus).toBe("canceled");

    const secondCancel = await app.request(`/api/v1/invoices/${stillInitiated!.id}/cancel`, {
      method: "POST",
      headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf },
    });
    expect(secondCancel.status).toBe(409);
  });

  test("a maker cannot cancel an invoice", async () => {
    const maker = await login(app, makerEmail);

    const anyInvoice = [...store.values()].find((inv) => inv.metadata.platform_batch_id === batchId);
    expect(anyInvoice).toBeDefined();

    const res = await app.request(`/api/v1/invoices/${anyInvoice!.id}/cancel`, {
      method: "POST",
      headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/v1/invoices returns the local mirror with pagination meta", async () => {
    const maker = await login(app, makerEmail);

    const res = await app.request(`/api/v1/invoices?batchId=${batchId}&page=1&perPage=25`, {
      headers: { cookie: maker.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.meta).toEqual({ page: 1, perPage: 25, total: 2, totalPages: 1 });
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
