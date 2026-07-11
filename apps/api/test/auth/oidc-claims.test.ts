import { describe, expect, test } from "bun:test";
import { mapClaims } from "../../src/modules/auth/oidc/claims";

const cfg = { identityClaim: "oid", groupsClaim: "groups", emailClaim: "email", nameClaim: "name" };

describe("mapClaims", () => {
  test("reads configured claim names (Entra-shaped)", () => {
    const c = mapClaims({ oid: "abc", email: "a@x.com", name: "A", groups: ["g1", "g2"] }, cfg);
    expect(c).toEqual({ subject: "abc", email: "a@x.com", name: "A", groups: ["g1", "g2"] });
  });
  test("falls back email to preferred_username; groups default []", () => {
    const c = mapClaims({ oid: "abc", preferred_username: "a@x.com", name: "A" }, cfg);
    expect(c.email).toBe("a@x.com");
    expect(c.groups).toEqual([]);
  });
  test("throws when the identity claim is missing", () => {
    expect(() => mapClaims({ email: "a@x.com" }, cfg)).toThrow();
  });
});
