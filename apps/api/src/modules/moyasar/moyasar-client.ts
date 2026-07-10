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
