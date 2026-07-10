import { expect, test } from "bun:test";
import { MoyasarClient } from "../../src/modules/moyasar/moyasar-client";
import { MoyasarApiError } from "../../src/errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const invoice = (id: string, status: string) => ({
  id, status, amount: 14999, currency: "SAR", description: "x", url: `https://pay/${id}`, metadata: { platform_item_id: "a" },
});

test("fetchInvoice GETs /invoices/:id and returns the parsed invoice", async () => {
  let seenUrl = "";
  const fetchImpl = (async (url: string) => { seenUrl = url; return jsonResponse(invoice("inv_1", "paid")); }) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://api.moyasar.com/v1", secretKey: "sk", fetchImpl });
  const out = await client.fetchInvoice("inv_1");
  expect(seenUrl).toBe("https://api.moyasar.com/v1/invoices/inv_1");
  expect(out.status).toBe("paid");
});

test("cancel PUTs /invoices/:id/cancel and returns the canceled invoice", async () => {
  let seen: { url: string; method?: string } = { url: "" };
  const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, method: init.method }; return jsonResponse(invoice("inv_2", "canceled")); }) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://b", secretKey: "sk", fetchImpl });
  const out = await client.cancel("inv_2");
  expect(seen.url).toBe("https://b/invoices/inv_2/cancel");
  expect(seen.method).toBe("PUT");
  expect(out.status).toBe("canceled");
});

test("fetchInvoice retries a 500 then succeeds", async () => {
  let n = 0;
  const fetchImpl = (async () => { n++; return n === 1 ? jsonResponse({ message: "boom" }, 500) : jsonResponse(invoice("inv_3", "paid")); }) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://b", secretKey: "sk", fetchImpl, retryBaseMs: 1 });
  expect((await client.fetchInvoice("inv_3")).status).toBe("paid");
  expect(n).toBe(2);
});

test("cancel of a missing invoice (404) throws MoyasarApiError", async () => {
  const fetchImpl = (async () => jsonResponse({ message: "not found" }, 404)) as unknown as typeof fetch;
  const client = new MoyasarClient({ baseUrl: "https://b", secretKey: "sk", fetchImpl });
  await expect(client.cancel("nope")).rejects.toBeInstanceOf(MoyasarApiError);
});
