export const qk = {
  me: ["me"] as const,
  batches: (q?: unknown) => ["batches", q] as const,
  batch: (id: string) => ["batch", id] as const,
  invoices: (q?: unknown) => ["invoices", q] as const,
  users: ["users"] as const,
  settings: ["settings"] as const,
  audit: (q?: unknown) => ["audit", q] as const,
};
