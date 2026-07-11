import type { AuthUrlResult, OidcClaims, OidcClient } from "../../src/modules/auth/oidc/oidc-client";

export class FakeOidcClient implements OidcClient {
  nextClaims: OidcClaims = { subject: "oid-1", email: "a@x.com", name: "A", groups: [] };
  lastCallback: { currentUrl: string; expectedState: string } | null = null;

  async authorizationUrl(): Promise<AuthUrlResult> {
    return { url: "https://idp.test/authorize?state=s", state: "s", nonce: "n", codeVerifier: "v" };
  }
  async handleCallback(input: {
    currentUrl: string;
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
  }): Promise<OidcClaims> {
    this.lastCallback = { currentUrl: input.currentUrl, expectedState: input.expectedState };
    return this.nextClaims;
  }
  endSessionUrl(): string | null {
    return "https://idp.test/logout";
  }
}
