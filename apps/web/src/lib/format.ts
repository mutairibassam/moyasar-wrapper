/** Render an ISO timestamp as a compact, locale-stable date-time (UTC). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** Turn a snake_case status/enum value into a human label ("partially_failed" -> "partially failed"). */
export function humanize(value: string): string {
  return value.replace(/_/g, " ");
}
