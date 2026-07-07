import { describe, expect, test } from "bun:test";
import {
  createBatchSchema,
  listBatchesQuerySchema,
  rejectBatchSchema,
  replaceItemsSchema,
} from "../src/schemas/batch";

describe("createBatchSchema", () => {
  test("accepts a name + currency and uppercases the currency", () => {
    const v = createBatchSchema.parse({ name: "March payouts", currency: "sar" });
    expect(v.currency).toBe("SAR");
  });
  test("rejects a blank name and a bad currency", () => {
    expect(() => createBatchSchema.parse({ name: " ", currency: "SAR" })).toThrow();
    expect(() => createBatchSchema.parse({ name: "x", currency: "SARR" })).toThrow();
  });
});

describe("replaceItemsSchema", () => {
  test("accepts an array of item inputs", () => {
    const v = replaceItemsSchema.parse({
      items: [{ amount: 14999, currency: "SAR", description: "A" }],
    });
    expect(v.items).toHaveLength(1);
  });
  test("accepts an empty array (clearing the grid)", () => {
    expect(replaceItemsSchema.parse({ items: [] }).items).toEqual([]);
  });
  test("rejects more than 1000 items", () => {
    const items = Array.from({ length: 1001 }, () => ({ amount: 100, currency: "SAR", description: "x" }));
    expect(() => replaceItemsSchema.parse({ items })).toThrow();
  });
});

describe("rejectBatchSchema", () => {
  test("requires a non-empty comment", () => {
    expect(rejectBatchSchema.parse({ comment: "Fix amounts" }).comment).toBe("Fix amounts");
    expect(() => rejectBatchSchema.parse({ comment: "" })).toThrow();
  });
});

describe("listBatchesQuerySchema", () => {
  test("defaults page/perPage and accepts a status filter", () => {
    const v = listBatchesQuerySchema.parse({});
    expect(v.page).toBe(1);
    expect(v.perPage).toBe(25);
    expect(listBatchesQuerySchema.parse({ status: "draft" }).status).toBe("draft");
  });
  test("rejects an unknown status", () => {
    expect(() => listBatchesQuerySchema.parse({ status: "nope" })).toThrow();
  });
});
