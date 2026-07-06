const MINOR_UNIT_DIGITS: Record<string, number> = {
  SAR: 2,
  USD: 2,
  EUR: 2,
  AED: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export class MoneyError extends Error {}

export function minorUnitDigits(currency: string): number {
  const digits = MINOR_UNIT_DIGITS[currency.toUpperCase()];
  if (digits === undefined) {
    throw new MoneyError(`Unsupported currency: ${currency}`);
  }
  return digits;
}

export function toMinorUnits(major: string, currency: string): number {
  const digits = minorUnitDigits(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(major.trim());
  if (!match || major.trim() === "") {
    throw new MoneyError(`Invalid amount: "${major}"`);
  }
  const whole = match[1]!;
  const frac = match[2] ?? "";
  if (frac.length > digits) {
    throw new MoneyError(
      `Amount "${major}" exceeds ${digits} decimal places allowed for ${currency}`,
    );
  }
  const minor =
    Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`Amount "${major}" is too large`);
  }
  return minor;
}

export function formatMinorUnits(amount: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new MoneyError(`Invalid minor-unit amount: ${amount}`);
  }
  const padded = String(amount).padStart(digits + 1, "0");
  const whole = padded.slice(0, padded.length - digits);
  const frac = digits === 0 ? "" : `.${padded.slice(padded.length - digits)}`;
  return `${whole}${frac} ${currency.toUpperCase()}`;
}
