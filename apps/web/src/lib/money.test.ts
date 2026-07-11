import { describe, expect, test } from "vitest";
import { toMajorUnits, toMinorUnits } from "./money";

describe("toMinorUnits", () => {
  test("converts whole and fractional major units", () => {
    expect(toMinorUnits("10.50")).toBe(1050);
    expect(toMinorUnits("1")).toBe(100);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits("100")).toBe(10000);
  });
  test("rounds half-up on the third fractional digit", () => {
    expect(toMinorUnits("10.005")).toBe(1001);
    expect(toMinorUnits("10.004")).toBe(1000);
  });
  test("accepts numeric input", () => {
    expect(toMinorUnits(10.5)).toBe(1050);
  });
  test("throws on non-numeric input", () => {
    expect(() => toMinorUnits("abc")).toThrow();
    expect(() => toMinorUnits("")).toThrow();
  });
});

describe("toMajorUnits", () => {
  test("formats minor units to a 2dp major string", () => {
    expect(toMajorUnits(1050)).toBe("10.50");
    expect(toMajorUnits(100)).toBe("1.00");
    expect(toMajorUnits(0)).toBe("0.00");
  });
});
