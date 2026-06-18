import { getPublicOrigin, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { OAUTH } from "@/lib/oauth/config";

// RFC 8414 Authorization Server Metadata (issue #151). aido is the AS for its
// own MCP resource server. Public clients (Claude) use the authorization-code
// flow with PKCE (S256) and register dynamically. The advertised endpoints land
// in #152 (register), #153 (authorize) and #154 (token).

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = getPublicOrigin(req).replace(/\/$/, "");
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [OAUTH.scope],
    },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
