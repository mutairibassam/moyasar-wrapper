import type { ItemRow, Repositories } from "@moyasar-ops/db";
import { MOYASAR_INVOICE_STATUSES } from "@moyasar-ops/shared";
import { MoyasarApiError } from "../../errors";
import type { MoyasarInvoice } from "./moyasar-types";

/** The subset of the Moyasar client the sync engine depends on. `MoyasarClient` satisfies it. */
export interface SyncClient {
  listByBatch(id: string, page: number): Promise<{ invoices: MoyasarInvoice[]; nextPage: number | null }>;
}

const MAX_SYNC_PAGES = 1000;
const VALID_STATUSES = new Set<string>([...MOYASAR_INVOICE_STATUSES]);

/**
 * Polls Moyasar for the current status of open (still-`initiated`/`on_hold`)
 * invoices and reconciles the local `moyasar_status`. It writes ONLY
 * `moyasar_status`/`last_synced_at` via `repos.items.syncStatus` — it never
 * touches an item's submission `status` column or any batch status.
 */
export class SyncEngine {
  private readonly repos: Repositories;
  private readonly client: SyncClient;

  constructor(deps: { repos: Repositories; client: SyncClient }) {
    this.repos = deps.repos;
    this.client = deps.client;
  }

  async syncOpenInvoices(): Promise<{ scanned: number; updated: number }> {
    const open = await this.repos.items.listOpenSubmitted();
    const batchIds = [...new Set(open.map((i) => i.batchId))];
    let scanned = 0;
    let updated = 0;
    for (const batchId of batchIds) {
      const result = await this.syncBatch(batchId);
      scanned += result.scanned;
      updated += result.updated;
    }
    return { scanned, updated };
  }

  async syncBatch(batchId: string): Promise<{ scanned: number; updated: number }> {
    // 1. Page through Moyasar's invoices for this batch, keyed by our platform_item_id.
    const statusByItemId = new Map<string, string>();
    let page = 1;
    let pagesFetched = 0;
    for (;;) {
      const { invoices, nextPage } = await this.client.listByBatch(batchId, page);
      pagesFetched++;
      for (const invoice of invoices) {
        const platformItemId = invoice.metadata?.platform_item_id;
        if (platformItemId) statusByItemId.set(platformItemId, invoice.status);
      }
      if (nextPage === null) break;
      if (nextPage <= page || pagesFetched >= MAX_SYNC_PAGES) {
        throw new MoyasarApiError("Sync pagination exceeded bound or did not advance", undefined, true);
      }
      page = nextPage;
    }

    // 2. Reconcile only this batch's still-open items.
    const open = (await this.repos.items.listOpenSubmitted()).filter((i) => i.batchId === batchId);
    let scanned = 0;
    let updated = 0;
    for (const item of open) {
      scanned++;
      const status = statusByItemId.get(item.id);
      if (status === undefined || status === item.moyasarStatus) continue;
      if (!VALID_STATUSES.has(status)) continue; // ignore unrecognized upstream statuses
      await this.repos.items.syncStatus(item.id, status as NonNullable<ItemRow["moyasarStatus"]>);
      updated++;
    }
    return { scanned, updated };
  }
}
