import { rateLimit } from "@/lib/apiKeys";
import { signAccessToken } from "@/lib/oauth/tokens";
import { verifyPkceS256 } from "@/lib/oauth/pkce";
import { OAUTH, resourceUrl, requestOrigin } from "@/lib/oauth/config";
import {
  consumeAuthCode,
  createRefreshToken,
  consumeRefreshToken,
  revokeRefreshToken,
} from "@/lib/oauth/store";

// OAuth token endpoint (RFC 6749, issue #154). Exchanges an authorization code
// (with PKCE) or a refresh token for a short-lived JWT access token (+ a rotated
// refresh token). Form-encoded per spec. Web Request/Response → testable.

export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}
function err(error: string, description: string, status: number): Response {
  return Response.json({ error, error_description: description }, { status, headers: CORS });
}

async function issueTokens(
  req: Request,
  grant: { uid: string; clientId: string; scope: string }
): Promise<Response> {
  const origin = requestOrigin(req);
  let accessToken: string;
  let expiresIn: number;
  try {
    ({ accessToken, expiresIn } = await signAccessToken({
      issuer: origin,
      audience: resourceUrl(origin),
      uid: grant.uid,
      scope: grant.scope,
      clientId: grant.clientId,
    }));
  } catch (e) {
    console.error("[oauth/token] signing failed", e);
    return err("server_error", "Token signing is not configured.", 503);
  }
  const refreshToken = await createRefreshToken(grant);
  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: grant.scope,
    },
    { headers: { "Cache-Control": "no-store", ...CORS } }
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`oauth:token:${clientIp(req)}`, { max: 60, windowMs: 60 * 60 * 1000 })) {
    return err("rate_limited", "Too many token requests; try again later.", 429);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err("invalid_request", "Expected application/x-www-form-urlencoded body.", 400);
  }
  const s = (k: string) => String(form.get(k) ?? "");
  const grantType = s("grant_type");

  if (grantType === "authorization_code") {
    const code = s("code");
    const codeVerifier = s("code_verifier");
    const redirectUri = s("redirect_uri");
    const clientId = s("client_id");
    if (!code || !codeVerifier) return err("invalid_request", "Missing code or code_verifier.", 400);

    const data = await consumeAuthCode(code);
    if (!data) return err("invalid_grant", "Authorization code is invalid, used or expired.", 400);
    if (data.clientId !== clientId) return err("invalid_grant", "client_id mismatch.", 400);
    if (data.redirectUri !== redirectUri) return err("invalid_grant", "redirect_uri mismatch.", 400);
    if (!verifyPkceS256(codeVerifier, data.codeChallenge)) {
      return err("invalid_grant", "PKCE verification failed.", 400);
    }
    return issueTokens(req, { uid: data.uid, clientId: data.clientId, scope: data.scope });
  }

  if (grantType === "refresh_token") {
    const refreshToken = s("refresh_token");
    if (!refreshToken) return err("invalid_request", "Missing refresh_token.", 400);
    const data = await consumeRefreshToken(refreshToken);
    if (!data) return err("invalid_grant", "Refresh token is invalid, revoked or expired.", 400);
    // Rotate: revoke the presented token, issue a fresh pair.
    await revokeRefreshToken(refreshToken);
    return issueTokens(req, { uid: data.uid, clientId: data.clientId, scope: data.scope || OAUTH.scope });
  }

  return err("unsupported_grant_type", `Unsupported grant_type: ${grantType}.`, 400);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
