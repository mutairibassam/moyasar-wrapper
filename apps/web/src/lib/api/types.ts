export type UserRole = "admin" | "maker" | "approver" | "viewer";
export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
};
export type PageMeta = { page: number; perPage: number; total: number; totalPages: number };

export type BatchStatus =
  | "draft"
  | "pending_approval"
  | "rejected"
  | "approved"
  | "submitting"
  | "submitted"
  | "partially_failed";
export type BatchSummary = {
  id: string;
  name: string;
  status: BatchStatus;
  currency: string;
  itemCount: number;
  totalAmount: number;
  createdBy: string;
  createdAt: string;
};
export type ItemStatus = "draft" | "valid" | "invalid" | "submitting" | "submitted" | "failed";
export type MoyasarStatus =
  | "initiated"
  | "paid"
  | "failed"
  | "refunded"
  | "canceled"
  | "on_hold"
  | "expired"
  | "voided";
export type ItemView = {
  id: string;
  rowNumber: number;
  amount: number;
  amountFormatted: string;
  currency: string;
  description: string;
  expiredAt: string | null;
  metadata: Record<string, string> | null;
  status: ItemStatus;
  validationErrors: Record<string, string[]> | null;
  moyasarInvoiceId: string | null;
  moyasarStatus: MoyasarStatus | null;
  moyasarUrl: string | null;
};
export type BatchView = {
  id: string;
  name: string;
  status: BatchStatus;
  source: "csv" | "manual";
  mode: "test" | "live";
  currency: string;
  createdBy: string;
  approvedBy: string | null;
  rejectionComment: string | null;
  itemCount: number;
  totalAmount: number;
  totalAmountFormatted: string;
  createdAt: string;
  updatedAt: string;
  items: ItemView[];
};
export type SettingsView = {
  activeMode: "test" | "live";
  testKeySet: boolean;
  liveKeySet: boolean;
  updatedAt: string;
};
export type AuditEntry = {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
};
