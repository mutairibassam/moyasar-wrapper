import { cva } from "class-variance-authority";
import type { BatchStatus, ItemStatus, MoyasarStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Tone = "green" | "red" | "amber" | "blue" | "gray";

const toneClass: Record<Tone, string> = {
  green: "bg-green-100 text-green-800 border-green-200",
  red: "bg-red-100 text-red-800 border-red-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
  gray: "bg-gray-100 text-gray-700 border-gray-200",
};

const batchTone: Record<BatchStatus, Tone> = {
  draft: "gray",
  pending_approval: "amber",
  rejected: "red",
  approved: "blue",
  submitting: "amber",
  submitted: "green",
  partially_failed: "red",
};

const itemTone: Record<ItemStatus, Tone> = {
  draft: "gray",
  valid: "blue",
  invalid: "red",
  submitting: "amber",
  submitted: "green",
  failed: "red",
};

const moyasarTone: Record<MoyasarStatus, Tone> = {
  initiated: "amber",
  paid: "green",
  failed: "red",
  refunded: "blue",
  canceled: "red",
  on_hold: "amber",
  expired: "red",
  voided: "red",
};

const badge = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
);

type StatusBadgeProps =
  | { kind: "batch"; value: BatchStatus }
  | { kind: "item"; value: ItemStatus }
  | { kind: "moyasar"; value: MoyasarStatus };

function toneFor(props: StatusBadgeProps): Tone {
  switch (props.kind) {
    case "batch":
      return batchTone[props.value];
    case "item":
      return itemTone[props.value];
    case "moyasar":
      return moyasarTone[props.value];
  }
}

export function StatusBadge(props: StatusBadgeProps) {
  const tone = toneFor(props);
  const label = props.value.replace(/_/g, " ");
  return <span className={cn(badge(), toneClass[tone])}>{label}</span>;
}
