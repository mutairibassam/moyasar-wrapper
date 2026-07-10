import type { NewItemRow, Repositories } from "@moyasar-ops/db";
import {
  type CreateBatchInput,
  type InvoiceItemInput,
  type ListBatchesQuery,
  invoiceItemInputSchema,
  parseInvoicesCsv,
} from "@moyasar-ops/shared";
import { AuthzError, NotFoundError, StateTransitionError, ValidationError } from "../../errors";
import type { PublicUser } from "../auth/public-user";
import { type BatchView, toBatchView } from "./batch-view";

export type BatchSummary = {
  id: string;
  name: string;
  status: string;
  currency: string;
  itemCount: number;
  totalAmount: number;
  createdBy: string;
  createdAt: string;
};
export type PageMeta = { page: number; perPage: number; total: number; totalPages: number };

const EDITABLE_STATUSES = new Set(["draft", "rejected"]);

function canWrite(actor: PublicUser): boolean {
  return actor.role === "maker" || actor.role === "admin";
}

export class BatchesService {
  constructor(private readonly repos: Repositories) {}

  private async loadView(batchId: string): Promise<BatchView> {
    return this.loadViewTx(this.repos, batchId);
  }

  /** Build a BatchView from any executor (base repos or a transaction-scoped bundle). */
  private async loadViewTx(r: Repositories, batchId: string): Promise<BatchView> {
    const batch = await r.batches.findById(batchId);
    if (!batch) throw new NotFoundError("Batch not found");
    const items = await r.items.listByBatch(batchId);
    return toBatchView(batch, items);
  }

  async create(actor: PublicUser, input: CreateBatchInput, ctx: { ip: string | null }): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to create batches");
    return this.repos.transaction(async (r) => {
      const batch = await r.batches.create({
        name: input.name,
        currency: input.currency,
        source: "manual",
        createdBy: actor.id,
      });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.created",
        entityType: "batch",
        entityId: batch.id,
        after: { name: batch.name, currency: batch.currency },
        ip: ctx.ip,
      });
      return toBatchView(batch, []);
    });
  }

  async list(actor: PublicUser, opts: ListBatchesQuery): Promise<{ items: BatchSummary[]; meta: PageMeta }> {
    const { items, total } = await this.repos.batches.list({
      page: opts.page,
      perPage: opts.perPage,
      status: opts.status,
    });
    return {
      items: items.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        currency: b.currency,
        itemCount: b.itemCount,
        totalAmount: b.totalAmount,
        createdBy: b.createdBy,
        createdAt: b.createdAt.toISOString(),
      })),
      meta: {
        page: opts.page,
        perPage: opts.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / opts.perPage)),
      },
    };
  }

  async get(_actor: PublicUser, id: string): Promise<BatchView> {
    return this.loadView(id);
  }

  /** Turn candidate inputs into item rows (valid rows counted into the total). */
  private stageRows(
    batchId: string,
    currency: string,
    candidates: { input?: InvoiceItemInput; errors: Record<string, string[]> }[],
  ): { rows: NewItemRow[]; total: number } {
    let total = 0;
    const rows = candidates.map((c, idx): NewItemRow => {
      const rowNumber = idx + 1;
      if (c.input && Object.keys(c.errors).length === 0) {
        total += c.input.amount;
        return {
          batchId,
          rowNumber,
          amount: c.input.amount,
          currency: c.input.currency,
          description: c.input.description,
          expiredAt: c.input.expiredAt ?? null,
          successUrl: c.input.successUrl ?? null,
          backUrl: c.input.backUrl ?? null,
          callbackUrl: c.input.callbackUrl ?? null,
          metadata: c.input.metadata ?? null,
          status: "valid",
          validationErrors: null,
        };
      }
      return {
        batchId,
        rowNumber,
        amount: c.input?.amount ?? 0,
        currency,
        description: c.input?.description ?? "",
        status: "invalid",
        validationErrors: c.errors,
      };
    });
    return { rows, total };
  }

  private async writeItems(
    actor: PublicUser,
    id: string,
    source: "manual" | "csv",
    candidates: { input?: InvoiceItemInput; errors: Record<string, string[]> }[],
    ctx: { ip: string | null },
  ): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to edit batches");
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (!EDITABLE_STATUSES.has(batch.status)) {
      throw new StateTransitionError(`Batch cannot be edited while it is ${batch.status}`);
    }

    const { rows, total } = this.stageRows(id, batch.currency, candidates);

    return this.repos.transaction(async (r) => {
      await r.items.deleteByBatch(id);
      await r.items.insertMany(rows);
      await r.batches.update(id, {
        source,
        status: "draft",
        itemCount: rows.length,
        totalAmount: total,
        rejectionComment: null,
      });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.items_replaced",
        entityType: "batch",
        entityId: id,
        after: { itemCount: rows.length, totalAmount: total, source },
        ip: ctx.ip,
      });
      return this.loadViewTx(r, id);
    });
  }

  async replaceItems(
    actor: PublicUser,
    id: string,
    items: InvoiceItemInput[],
    ctx: { ip: string | null },
  ): Promise<BatchView> {
    const candidates = items.map((item) => {
      const parsed = invoiceItemInputSchema.safeParse(item);
      if (parsed.success) return { input: parsed.data, errors: {} as Record<string, string[]> };
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_");
        (errors[key] ??= []).push(issue.message);
      }
      return { errors };
    });
    return this.writeItems(actor, id, "manual", candidates, ctx);
  }

  async ingestCsv(
    actor: PublicUser,
    id: string,
    csvText: string,
    ctx: { ip: string | null },
  ): Promise<BatchView> {
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    const result = parseInvoicesCsv(csvText, { currency: batch.currency });
    if (result.fileErrors.length > 0) {
      throw new ValidationError(`The CSV file could not be read: ${result.fileErrors.join(" ")}`, {
        fileErrors: result.fileErrors,
      });
    }
    const candidates = result.rows.map((row) => ({ input: row.input, errors: row.errors }));
    return this.writeItems(actor, id, "csv", candidates, ctx);
  }

  async submitForApproval(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to submit batches");
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (!EDITABLE_STATUSES.has(batch.status)) {
      throw new StateTransitionError(`Only a draft or rejected batch can be submitted (it is ${batch.status})`);
    }
    const counts = await this.repos.items.countByBatch(id);
    if (counts.total === 0) throw new ValidationError("A batch needs at least one item before submission");
    if (counts.invalid > 0) {
      throw new ValidationError(`The batch has ${counts.invalid} invalid row(s); fix them before submitting`);
    }

    return this.repos.transaction(async (r) => {
      await r.batches.update(id, {
        status: "pending_approval",
        submittedForApprovalAt: new Date(),
        rejectionComment: null,
      });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.submitted_for_approval",
        entityType: "batch",
        entityId: id,
        ip: ctx.ip,
      });
      return this.loadViewTx(r, id);
    });
  }

  async approve(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (actor.role !== "approver" && actor.role !== "admin") {
      throw new AuthzError("You do not have permission to approve batches");
    }
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.status !== "pending_approval") {
      throw new StateTransitionError(`Only a pending_approval batch can be approved (it is ${batch.status})`);
    }
    if (batch.createdBy === actor.id) {
      throw new AuthzError("You cannot approve your own batch");
    }

    return this.repos.transaction(async (r) => {
      const settings = await r.settings.get();
      const mode = settings.activeMode;
      const before = { status: batch.status };
      const updated = await r.batches.update(
        id,
        {
          status: "approved",
          approvedBy: actor.id,
          approvedAt: new Date(),
          mode, // active mode snapshotted from settings at approval time
        },
        "pending_approval",
      );
      if (!updated) throw new StateTransitionError("Batch is no longer pending approval");
      await r.audit.record({
        actorId: actor.id,
        action: "batch.approved",
        entityType: "batch",
        entityId: id,
        before,
        after: { status: "approved", approvedBy: actor.id },
        ip: ctx.ip,
      });
      await r.jobs.enqueue("submit_batch", { batchId: id });
      return this.loadViewTx(r, id);
    });
  }

  async reject(actor: PublicUser, id: string, comment: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (actor.role !== "approver" && actor.role !== "admin") {
      throw new AuthzError("You do not have permission to reject batches");
    }
    if (comment.trim() === "") throw new ValidationError("A rejection comment is required");
    const batch = await this.repos.batches.findById(id);
    if (!batch) throw new NotFoundError("Batch not found");
    if (batch.status !== "pending_approval") {
      throw new StateTransitionError(`Only a pending_approval batch can be rejected (it is ${batch.status})`);
    }
    if (batch.createdBy === actor.id) {
      throw new AuthzError("You cannot reject your own batch");
    }

    return this.repos.transaction(async (r) => {
      const before = { status: batch.status };
      const updated = await r.batches.update(
        id,
        { status: "rejected", rejectionComment: comment },
        "pending_approval",
      );
      if (!updated) throw new StateTransitionError("Batch is no longer pending approval");
      await r.audit.record({
        actorId: actor.id,
        action: "batch.rejected",
        entityType: "batch",
        entityId: id,
        before,
        after: { status: "rejected", comment },
        ip: ctx.ip,
      });
      return this.loadViewTx(r, id);
    });
  }

  async cloneFailed(actor: PublicUser, id: string, ctx: { ip: string | null }): Promise<BatchView> {
    if (!canWrite(actor)) throw new AuthzError("You do not have permission to clone batches");
    const source = await this.repos.batches.findById(id);
    if (!source) throw new NotFoundError("Batch not found");
    const items = await this.repos.items.listByBatch(id);
    const failed = items.filter((i) => i.status === "invalid" || i.status === "failed");
    if (failed.length === 0) {
      throw new ValidationError("This batch has no invalid or failed rows to clone");
    }

    return this.repos.transaction(async (r) => {
      const clone = await r.batches.create({
        name: `${source.name} (retry)`,
        currency: source.currency,
        source: source.source,
        createdBy: actor.id,
      });
      const rows = failed.map((item, idx) => ({
        batchId: clone.id,
        rowNumber: idx + 1,
        amount: item.amount,
        currency: item.currency,
        description: item.description,
        expiredAt: item.expiredAt,
        successUrl: item.successUrl,
        backUrl: item.backUrl,
        callbackUrl: item.callbackUrl,
        metadata: item.metadata,
        status: "draft" as const,
        validationErrors: null,
      }));
      await r.items.insertMany(rows);
      await r.batches.update(clone.id, { itemCount: rows.length });
      await r.audit.record({
        actorId: actor.id,
        action: "batch.cloned_from_failed",
        entityType: "batch",
        entityId: clone.id,
        after: { clonedFrom: id, rows: rows.length },
        ip: ctx.ip,
      });
      return this.loadViewTx(r, clone.id);
    });
  }
}
