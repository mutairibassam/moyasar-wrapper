import { afterAll, beforeAll, expect, test } from "bun:test";
import { createDb, createRepositories, invoiceBatches, invoiceItems, jobs, sessions } from "@moyasar-ops/db";
import { eq, inArray, sql } from "drizzle-orm";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { createContainer } from "../../src/container";
import { hashPassword } from "../../src/modules/auth/password";

const url = process.env.DATABASE_URL ?? "postgres://moyasar_ops:dev_password@localhost:5433/moyasar_ops";
const db = createDb(url);
const config = {
  ...loadConfig({
    DATABASE_URL: url,
    KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  } as NodeJS.ProcessEnv),
  cookieSecure: false,
};
const app = createApp(createContainer(db, config));

const stamp = Date.now();
const makerEmail = `bf-maker-${stamp}@example.com`;
const approverEmail = `bf-approver-${stamp}@example.com`;
const ids: string[] = [];

async function seed(email: string, role: "maker" | "approver") {
  const repos = createRepositories(db);
  const u = await repos.users.create({ email, passwordHash: await hashPassword("a-strong-password"), displayName: role, role });
  ids.push(u.id);
  return u.id;
}
function jar(setCookies: string[]) {
  const parts = setCookies.map((c) => c.split(";")[0]!);
  const csrf = parts.find((c) => c.startsWith("csrf_token="))!.split("=")[1]!;
  return { cookie: parts.join("; "), csrf };
}
async function login(email: string) {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "a-strong-password" }),
  });
  return jar(res.headers.getSetCookie());
}

beforeAll(async () => {
  await seed(makerEmail, "maker");
  await seed(approverEmail, "approver");
});

test("maker creates+fills a batch, submits; approver approves; self-approval is blocked", async () => {
  const maker = await login(makerEmail);
  const approver = await login(approverEmail);

  // Create
  const created = await app.request("/api/v1/batches", {
    method: "POST",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ name: "Integration batch", currency: "SAR" }),
  });
  expect(created.status).toBe(201);
  const batchId = (await created.json()).batch.id as string;

  // Fill via grid
  const filled = await app.request(`/api/v1/batches/${batchId}/items`, {
    method: "PATCH",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ items: [{ amount: 14999, currency: "SAR", description: "Seat" }] }),
  });
  expect(filled.status).toBe(200);
  expect((await filled.json()).batch.totalAmount).toBe(14999);

  // Submit for approval
  const submitted = await app.request(`/api/v1/batches/${batchId}/submit-for-approval`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
  });
  expect(submitted.status).toBe(200);
  expect((await submitted.json()).batch.status).toBe("pending_approval");

  // Maker cannot approve (role guard => 403)
  const selfApprove = await app.request(`/api/v1/batches/${batchId}/approve`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
  });
  expect(selfApprove.status).toBe(403);

  // Approver approves
  const approved = await app.request(`/api/v1/batches/${batchId}/approve`, {
    method: "POST",
    headers: { cookie: approver.cookie, "x-csrf-token": approver.csrf },
  });
  expect(approved.status).toBe(200);
  expect((await approved.json()).batch.status).toBe("approved");

  // Approved batch is immutable
  const editAfter = await app.request(`/api/v1/batches/${batchId}/items`, {
    method: "PATCH",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ items: [{ amount: 100, currency: "SAR", description: "x" }] }),
  });
  expect(editAfter.status).toBe(409);
});

test("CSV upload validates rows and blocks submission until fixed", async () => {
  const maker = await login(makerEmail);
  const created = await app.request("/api/v1/batches", {
    method: "POST",
    headers: { cookie: maker.cookie, "content-type": "application/json", "x-csrf-token": maker.csrf },
    body: JSON.stringify({ name: "CSV batch", currency: "SAR" }),
  });
  const batchId = (await created.json()).batch.id as string;

  const csv = "amount,description,expired_at,success_url,back_url,callback_url\n149.99,Good,,,,\n0.50,Bad,,,,";
  const form = new FormData();
  form.append("file", new File([csv], "invoices.csv", { type: "text/csv" }));
  const uploaded = await app.request(`/api/v1/batches/${batchId}/csv`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
    body: form,
  });
  expect(uploaded.status).toBe(200);
  const view = (await uploaded.json()).batch;
  expect(view.items.filter((i: { status: string }) => i.status === "invalid")).toHaveLength(1);

  // Submission blocked while an invalid row remains
  const blocked = await app.request(`/api/v1/batches/${batchId}/submit-for-approval`, {
    method: "POST",
    headers: { cookie: maker.cookie, "x-csrf-token": maker.csrf },
  });
  expect(blocked.status).toBe(400);
});

afterAll(async () => {
  const bIds = (await db.select({ id: invoiceBatches.id }).from(invoiceBatches).where(inArray(invoiceBatches.createdBy, ids))).map((r) => r.id);
  if (bIds.length > 0) {
    // Approving a batch enqueues a submit_batch job ({ batchId }) — clean those up too, scoped to
    // the batch ids this test created, so we never truncate the whole jobs table.
    await db.delete(jobs).where(inArray(sql<string>`${jobs.payload}->>'batchId'`, bIds));
    await db.delete(invoiceItems).where(inArray(invoiceItems.batchId, bIds));
    await db.delete(invoiceBatches).where(inArray(invoiceBatches.id, bIds));
  }
  for (const id of ids) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    // audit_logs is append-only (trigger) — cannot delete; harmless test rows remain.
  }
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
});
