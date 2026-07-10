import { describe, expect, test } from "bun:test";
import { MoneyError, formatMinorUnits, minorUnitDigits, toMinorUnits } from "../src/money";

describe("toMinorUnits", () => {
  test("converts SAR major units to halalas", () => {
    expect(toMinorUnits("149.99", "SAR")).toBe(14999);
    expect(toMinorUnits("1", "SAR")).toBe(100);
    expect(toMinorUnits("1.5", "SAR")).toBe(150);
    expect(toMinorUnits("0.05", "SAR")).toBe(5);
  });

  test("handles 3-decimal currencies", () => {
    expect(toMinorUnits("1.999", "KWD")).toBe(1999);
    expect(toMinorUnits("1", "KWD")).toBe(1000);
  });

  test("rejects excess decimal places instead of rounding", () => {
    expect(() => toMinorUnits("1.999", "SAR")).toThrow(MoneyError);
    expect(() => toMinorUnits("1.0001", "KWD")).toThrow(MoneyError);
  });

  test("rejects malformed and negative amounts", () => {
    for (const bad of ["abc", "-5", "1,000", "", " ", "1.", ".5", "1e3"]) {
      expect(() => toMinorUnits(bad, "SAR")).toThrow(MoneyError);
    }
  });

  test("rejects unsupported currencies and unsafe magnitudes", () => {
    expect(() => toMinorUnits("1", "XXX")).toThrow(MoneyError);
    expect(() => toMinorUnits("99999999999999999", "SAR")).toThrow(MoneyError);
  });
});

describe("formatMinorUnits", () => {
  test("formats halalas as major units with currency", () => {
    expect(formatMinorUnits(14999, "SAR")).toBe("149.99 SAR");
    expect(formatMinorUnits(5, "SAR")).toBe("0.05 SAR");
    expect(formatMinorUnits(1999, "KWD")).toBe("1.999 KWD");
    expect(formatMinorUnits(0, "SAR")).toBe("0.00 SAR");
  });

  test("rejects non-integers and negatives", () => {
    expect(() => formatMinorUnits(1.5, "SAR")).toThrow(MoneyError);
    expect(() => formatMinorUnits(-1, "SAR")).toThrow(MoneyError);
  });
});

describe("minorUnitDigits", () => {
  test("is case-insensitive", () => {
    expect(minorUnitDigits("sar")).toBe(2);
    expect(minorUnitDigits("KWD")).toBe(3);
  });
});
