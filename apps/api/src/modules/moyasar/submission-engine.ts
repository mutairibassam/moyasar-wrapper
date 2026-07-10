import type { ItemRow, Repositories } from "@moyasar-ops/db";
import { MoyasarApiError, NotFoundError } from "../../errors";
import type { BulkInvoiceInput, MoyasarInvoice } from "./moyasar-types";

export interface SubmissionClient {
  createBulk(invoices: BulkInvoiceInput[]): Promise<MoyasarInvoice[]>;
  listByBatch(id: string, page: number): Promise<{ invoices: MoyasarInvoice[]; nextPage: number | null }>;
}

const CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function buildInvoiceInput(item: ItemRow, batchId: string): BulkInvoiceInput {
  const input: BulkInvoiceInput = {
    amount: item.amount,
    currency: item.currency,
    description: item.description,
    metadata: {
      platform_item_id: item.id,
      platform_batch_id: batchId,
      ...(item.metadata ?? {}),
    },
  };
  if (item.expiredAt) input.expired_at = item.expiredAt;
  if (item.successUrl) input.success_url = item.successUrl;
  if (item.backUrl) input.back_url = item.backUrl;
  if (item.callbackUrl) input.callback_url = item.callbackUrl;
  return input;
}

export class SubmissionEngine {
  private readonly repos: Repositories;
  private readonly client: SubmissionClient;

  constructor(opts: { repos: Repositories; client: SubmissionClient }) {
    this.repos = opts.repos;
    this.client = opts.client;
  }

  async submitBatch(batchId: string): Promise<void> {
    const batch = await this.repos.batches.findById(batchId);
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.status === "submitted") return;

    if (batch.status === "approved") {
      await this.repos.batches.update(batchId, { status: "submitting" }, "approved");
      await this.repos.audit.record({
        actorId: null,
        action: "batch.submission_started",
        entityType: "batch",
        entityId: batchId,
      });
    }

    // Reconcile first, always — heals anything created by a prior (crashed) run.
    await this.reconcile(batchId);

    const pending = (await this.repos.items.listByBatchAndStatus(batchId, "valid")).filter(
      (item) => !item.moyasarInvoiceId,
    );
    const chunks = chunk(pending, CHUNK_SIZE);

    for (const items of chunks) {
      const ids = items.map((i) => i.id);
      await this.repos.items.markSubmitting(ids);

      const inputs = items.map((item) => buildInvoiceInput(item, batchId));
      let created: MoyasarInvoice[];
      try {
        created = await this.client.createBulk(inputs);
      } catch (e) {
        if (e instanceof MoyasarApiError && e.ambiguous === false) {
          for (const item of items) {
            await this.repos.items.recordFailed(item.id, e.message);
          }
          continue;
        }
        // Ambiguous (5xx/network/timeout) or unknown error: stop and rethrow so the job retries.
        throw e;
      }

      const byItemId = new Map<string, MoyasarInvoice>();
      for (const invoice of created) {
        const itemId = invoice.metadata?.platform_item_id;
        if (itemId) byItemId.set(itemId, invoice);
      }
      for (const item of items) {
        const invoice = byItemId.get(item.id);
        if (invoice) {
          await this.repos.items.recordSubmitted(item.id, {
            id: invoice.id,
            url: invoice.url ?? null,
            status: invoice.status,
          });
        }
        // else: left "submitting"; the next reconcile pass heals it.
      }
    }

    await this.finalize(batchId);
  }

  private async reconcile(batchId: string): Promise<void> {
    const candidates = new Set<string>();
    for (const item of await this.repos.items.listByBatchAndStatus(batchId, "valid")) candidates.add(item.id);
    for (const item of await this.repos.items.listByBatchAndStatus(batchId, "submitting")) candidates.add(item.id);
    if (candidates.size === 0) return;

    let page = 1;
    for (;;) {
      const { invoices, nextPage } = await this.client.listByBatch(batchId, page);
      for (const invoice of invoices) {
        const itemId = invoice.metadata?.platform_item_id;
        if (itemId && candidates.has(itemId)) {
          await this.repos.items.recordSubmitted(itemId, {
            id: invoice.id,
            url: invoice.url ?? null,
            status: invoice.status,
          });
        }
      }
      if (nextPage === null) break;
      page = nextPage;
    }
  }

  private async finalize(batchId: string): Promise<void> {
    await this.repos.transaction(async (r) => {
      const items = await r.items.listByBatch(batchId);
      const relevant = items.filter((i) => i.status === "submitted" || i.status === "failed");
      const allSubmitted = relevant.length > 0 && relevant.every((i) => i.status === "submitted");
      const hasFailed = relevant.some((i) => i.status === "failed");

      if (allSubmitted) {
        await r.batches.update(batchId, { status: "submitted", completedAt: new Date() });
        await r.audit.record({
          actorId: null,
          action: "batch.submitted",
          entityType: "batch",
          entityId: batchId,
        });
      } else if (hasFailed) {
        await r.batches.update(batchId, { status: "partially_failed", completedAt: new Date() });
        await r.audit.record({
          actorId: null,
          action: "batch.partially_failed",
          entityType: "batch",
          entityId: batchId,
        });
      }
      // else: some items still submitting (shouldn't happen without a rethrow) — leave batch as submitting.
    });
  }
}
