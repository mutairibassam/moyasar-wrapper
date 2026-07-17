import { afterAll, beforeAll, expect, test } from "bun:test";
import { invoiceBatches, invoiceItems, jobs, sessions } from "@moyasar-ops/db";
import { eq, inArray, sql } from "drizzle-orm";
import { loginAs, makeTestApp } from "../support/auth";

const { app, db } = makeTestApp();

const stamp = Date.now();
const makerEmail = `bf-maker-${stamp}@example.com`;
const approverEmail = `bf-approver-${stamp}@example.com`;
const ids: string[] = [];

let maker: { cookie: string; csrf: string; userId: string };
let approver: { cookie: string; csrf: string; userId: string };

beforeAll(async () => {
  maker = await loginAs(app, { email: makerEmail, role: "maker" });
  ids.push(maker.userId);
  approver = await loginAs(app, { email: approverEmail, role: "approver" });
  ids.push(approver.userId);
});

test("maker creates+fills a batch, submits; approver approves; self-approval is blocked", async () => {
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
