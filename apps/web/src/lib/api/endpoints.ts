import type {
  CreateBatchInput,
  CreateUserInput,
  InvoiceItemInput,
  LoginInput,
  UpdateUserInput,
} from "@moyasar-ops/shared";
import { apiFetch } from "./client";
import type {
  AuditEntry,
  BatchSummary,
  BatchView,
  ItemView,
  PageMeta,
  PublicUser,
  SettingsView,
} from "./types";

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  auth: {
    login: (b: LoginInput) =>
      apiFetch<{ user: PublicUser }>("/auth/login", { method: "POST", body: b }),
    logout: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    me: () => apiFetch<{ user: PublicUser }>("/me"),
  },
  batches: {
    list: (q: { page?: number; perPage?: number; status?: string }) =>
      apiFetch<{ items: BatchSummary[]; meta: PageMeta }>(`/batches${qs(q)}`),
    get: (id: string) => apiFetch<{ batch: BatchView }>(`/batches/${id}`),
    create: (b: CreateBatchInput) =>
      apiFetch<{ batch: BatchView }>("/batches", { method: "POST", body: b }),
    replaceItems: (id: string, items: InvoiceItemInput[]) =>
      apiFetch<{ batch: BatchView }>(`/batches/${id}/items`, { method: "PATCH", body: { items } }),
    uploadCsv: (id: string, file: File) => {
      const fd = new FormData();
      fd.set("file", file);
      return apiFetch<{ batch: BatchView }>(`/batches/${id}/csv`, { method: "POST", formData: fd });
    },
    submitForApproval: (id: string) =>
      apiFetch<{ batch: BatchView }>(`/batches/${id}/submit-for-approval`, { method: "POST" }),
    approve: (id: string) =>
      apiFetch<{ batch: BatchView }>(`/batches/${id}/approve`, { method: "POST" }),
    reject: (id: string, comment: string) =>
      apiFetch<{ batch: BatchView }>(`/batches/${id}/reject`, { method: "POST", body: { comment } }),
    cloneFailed: (id: string) =>
      apiFetch<{ batch: BatchView }>(`/batches/${id}/clone-failed`, { method: "POST" }),
    refresh: (id: string) =>
      apiFetch<{ updated: number }>(`/batches/${id}/refresh`, { method: "POST" }),
  },
  invoices: {
    list: (q: Record<string, string | number | undefined>) =>
      apiFetch<{ items: ItemView[]; meta: PageMeta }>(`/invoices${qs(q)}`),
    cancel: (moyasarInvoiceId: string) =>
      apiFetch<{ invoice: ItemView }>(`/invoices/${moyasarInvoiceId}/cancel`, { method: "POST" }),
  },
  users: {
    list: () => apiFetch<{ users: PublicUser[] }>("/users"),
    create: (b: CreateUserInput) =>
      apiFetch<{ user: PublicUser }>("/users", { method: "POST", body: b }),
    update: (id: string, b: UpdateUserInput) =>
      apiFetch<{ user: PublicUser }>(`/users/${id}`, { method: "PATCH", body: b }),
  },
  settings: {
    get: () => apiFetch<{ settings: SettingsView }>("/settings"),
    setKey: (mode: string, key: string) =>
      apiFetch<{ settings: SettingsView }>("/settings/keys", { method: "PUT", body: { mode, key } }),
    setMode: (mode: string) =>
      apiFetch<{ settings: SettingsView }>("/settings/mode", { method: "PUT", body: { mode } }),
  },
  audit: {
    list: (q: Record<string, string | number | undefined>) =>
      apiFetch<{ items: AuditEntry[]; meta: PageMeta }>(`/audit${qs(q)}`),
  },
};
