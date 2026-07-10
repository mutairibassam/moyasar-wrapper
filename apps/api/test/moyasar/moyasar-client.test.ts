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
