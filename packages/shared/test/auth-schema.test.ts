import { describe, expect, test } from "bun:test";
import {
  createUserSchema,
  loginSchema,
  updateUserSchema,
} from "../src/schemas/auth";

describe("loginSchema", () => {
  test("accepts email + password and lowercases the email", () => {
    const v = loginSchema.parse({ email: "User@Example.COM", password: "whatever12345" });
    expect(v.email).toBe("user@example.com");
  });
  test("rejects malformed email and short password", () => {
    expect(() => loginSchema.parse({ email: "nope", password: "x" })).toThrow();
  });
});

describe("createUserSchema", () => {
  test("accepts a full valid user and lowercases the email", () => {
    const v = createUserSchema.parse({
      email: "New.User@Example.com",
      password: "a-strong-password",
      displayName: "New User",
      role: "maker",
    });
    expect(v.email).toBe("new.user@example.com");
    expect(v.role).toBe("maker");
  });
  test("rejects passwords shorter than 12 and unknown roles", () => {
    expect(() =>
      createUserSchema.parse({ email: "a@b.com", password: "short", displayName: "X", role: "maker" }),
    ).toThrow();
    expect(() =>
      createUserSchema.parse({ email: "a@b.com", password: "a-strong-password", displayName: "X", role: "root" }),
    ).toThrow();
  });
});

describe("updateUserSchema", () => {
  test("allows partial updates but rejects an empty object", () => {
    expect(updateUserSchema.parse({ role: "approver" }).role).toBe("approver");
    expect(updateUserSchema.parse({ isActive: false }).isActive).toBe(false);
    expect(() => updateUserSchema.parse({})).toThrow();
  });
  test("rejects a short password reset", () => {
    expect(() => updateUserSchema.parse({ password: "short" })).toThrow();
  });
});
