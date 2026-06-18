// OAuth Authorization Server config (issue #150, epic #157). aido acts as the
// AS for its own MCP Resource Server (/api/mcp/sse). Firebase provides the user
// login; this module owns tokens, PKCE and the AS storage.

export const OAUTH = {
  collections: {
    clients: "oauthClients",
    codes: "oauthCodes",
    refreshTokens: "oauthRefreshTokens",
  },
  /** Single starting scope: full tool access to the user's own spaces. */
  scope: "aido.tools",
  accessTokenTtlSec: 60 * 60, // 1 h
  authCodeTtlSec: 60, // one-time, short-lived
  refreshTokenTtlSec: 30 * 24 * 60 * 60, // 30 d
  refreshTokenPrefix: "aidor_",
} as const;

/**
 * The protected resource (the MCP endpoint) — used as the access token's
 * `aud`. The `iss` is the public origin. Endpoints derive `origin` from the
 * request (mcp-handler `getPublicOrigin`, proxy-aware); the MCP token check
 * derives the same so `aud`/`iss` line up.
 */
export function resourceUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/mcp/sse`;
}
