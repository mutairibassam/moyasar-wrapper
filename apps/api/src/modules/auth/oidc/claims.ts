import type { OidcClaims } from "./oidc-client";

export type ClaimNames = { identityClaim: string; groupsClaim: string; emailClaim: string; nameClaim: string };

export function mapClaims(raw: Record<string, unknown>, cfg: ClaimNames): OidcClaims {
  const subject = raw[cfg.identityClaim];
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error(`Missing identity claim '${cfg.identityClaim}'`);
  }
  const email = (raw[cfg.emailClaim] ?? raw.preferred_username ?? "") as string;
  const name = (raw[cfg.nameClaim] ?? email) as string;
  const groupsRaw = raw[cfg.groupsClaim];
  const groups = Array.isArray(groupsRaw) ? groupsRaw.map(String) : [];
  return { subject, email, name, groups };
}
