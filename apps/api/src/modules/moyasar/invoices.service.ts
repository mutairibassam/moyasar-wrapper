import type { InvoiceQuery, Repositories } from "@moyasar-ops/db";
import { AuthzError, NotFoundError, StateTransitionError } from "../../errors";
import type { PublicUser } from "../auth/public-user";
import { type ItemView, toItemView } from "../batches/batch-view";
import type { MoyasarInvoice } from "./moyasar-types";
import { SyncEngine, type SyncClient } from "./sync-engine";

/** The subset of the Moyasar client the invoices service depends on. `MoyasarClient` satisfies it. */
export type InvoiceOpsClient = SyncClient & {
  cancel(id: string): Promise<MoyasarInvoice>;
  fetchInvoice(id: string): Promise<MoyasarInvoice>;
};

export type PageMeta = { page: number; perPage: number; total: number; totalPages: number };

function canRefresh(actor: PublicUser): boolean {
  return actor.role === "maker" || actor.role === "approver" || actor.role === "admin";
}

export class InvoicesService {
  private readonly repos: Repositories;
  private readonly makeClient: () => Promise<InvoiceOpsClient>;

  constructor(deps: { repos: Repositories; makeClient: () => Promise<InvoiceOpsClient> }) {
    this.repos = deps.repos;
    this.makeClient = deps.makeClient;
  }

  async list(opts: InvoiceQuery): Promise<{ items: ItemView[]; meta: PageMeta }> {
    const { items, total } = await this.repos.items.queryInvoices(opts);
    return {
      items: items.map(toItemView),
      meta: {
        page: opts.page,
        perPage: opts.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
      },
    };
  }

  async cancel(actor: PublicUser, moyasarInvoiceId: string, ctx: { ip: string | null }): Promise<ItemView> {
    if (actor.role !== "approver" && actor.role !== "admin") {
      throw new AuthzError("You do not have permission to cancel invoices");
    }
    const item = await this.repos.items.findByMoyasarInvoiceId(moyasarInvoiceId);
    if (!item) throw new NotFoundError("Invoice not found");
    if (item.moyasarStatus !== "initiated") {
      throw new StateTransitionError(`Only an initiated invoice can be canceled (it is ${item.moyasarStatus})`);
    }

    const client = await this.makeClient();
    await client.cancel(moyasarInvoiceId);

    await this.repos.transaction(async (r) => {
      await r.items.syncStatus(item.id, "canceled");
      await r.audit.record({
        actorId: actor.id,
        action: "invoice.canceled",
        entityType: "invoice",
        entityId: moyasarInvoiceId,
        before: { moyasarStatus: "initiated" },
        after: { moyasarStatus: "canceled" },
        ip: ctx.ip,
      });
    });

    const updated = await this.repos.items.findByMoyasarInvoiceId(moyasarInvoiceId);
    return toItemView(updated!);
  }

  async refreshBatch(actor: PublicUser, batchId: string): Promise<{ updated: number }> {
    if (!canRefresh(actor)) {
      throw new AuthzError("You do not have permission to refresh invoice status");
    }
    const client = await this.makeClient();
    const engine = new SyncEngine({ repos: this.repos, client });
    const { updated } = await engine.syncBatch(batchId);
    return { updated };
  }
}
