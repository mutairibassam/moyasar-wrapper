export type OidcClaims = { subject: string; email: string; name: string; groups: string[] };
export type AuthUrlResult = { url: string; state: string; nonce: string; codeVerifier: string };

export interface OidcClient {
  authorizationUrl(): Promise<AuthUrlResult>;
  handleCallback(input: {
    currentUrl: string;
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
  }): Promise<OidcClaims>;
  endSessionUrl(): string | null;
}
