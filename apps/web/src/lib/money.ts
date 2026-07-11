/**
 * Convert a major-unit amount (e.g. "10.50" SAR) to integer minor units (halalas).
 * Parses the decimal string digit-by-digit and rounds half-up on the third
 * fractional digit — floating-point scaling (Number(x) * 100) is not exact for
 * values like "10.005" and would silently truncate.
 */
export function toMinorUnits(major: string | number): number {
  const s = String(major).trim();
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Invalid amount: ${JSON.stringify(major)}`);
  const sign = m[1] === "-" ? -1 : 1;
  const intPart = m[2]!;
  const fracPadded = ((m[3] ?? "") + "000").slice(0, 3);
  let cents = Number(intPart) * 100 + Number(fracPadded.slice(0, 2));
  if (Number(fracPadded[2]) >= 5) cents += 1;
  return sign * cents;
}

/** Convert integer minor units to a 2-decimal major-unit string ("1050" -> "10.50"). */
export function toMajorUnits(minor: number): string {
  return (minor / 100).toFixed(2);
}
