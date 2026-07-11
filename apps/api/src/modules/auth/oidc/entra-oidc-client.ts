import * as oidc from "openid-client";
import type { AuthUrlResult, OidcClaims, OidcClient } from "./oidc-client";
import { type ClaimNames, mapClaims } from "./claims";

type OidcConfig = { issuerUrl: string; clientId: string; clientSecret: string; redirectUri: string } & ClaimNames;

/**
 * Real OIDC adapter over openid-client@6. This is the only library-coupled
 * file; all callback/gate logic is tested via FakeOidcClient.
 */
export class EntraOidcClient implements OidcClient {
  private constructor(
    private readonly cfg: OidcConfig,
    private readonly config: oidc.Configuration,
  ) {}

  static async create(cfg: OidcConfig): Promise<EntraOidcClient> {
    const config = await oidc.discovery(new URL(cfg.issuerUrl), cfg.clientId, cfg.clientSecret);
    return new EntraOidcClient(cfg, config);
  }

  async authorizationUrl(): Promise<AuthUrlResult> {
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(this.config, {
      redirect_uri: this.cfg.redirectUri,
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    }).href;
    return { url, state, nonce, codeVerifier };
  }

  async handleCallback(input: {
    currentUrl: string;
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
  }): Promise<OidcClaims> {
    const tokens = await oidc.authorizationCodeGrant(this.config, new URL(input.currentUrl), {
      pkceCodeVerifier: input.codeVerifier,
      expectedState: input.expectedState,
      expectedNonce: input.expectedNonce,
    });
    const claims = tokens.claims();
    if (!claims) {
      throw new Error("OIDC callback did not return an ID token with claims");
    }
    return mapClaims(claims as Record<string, unknown>, this.cfg);
  }

  endSessionUrl(): string | null {
    try {
      return oidc.buildEndSessionUrl(this.config, {}).href;
    } catch {
      return null;
    }
  }
}
