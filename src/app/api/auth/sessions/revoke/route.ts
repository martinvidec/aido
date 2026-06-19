import { getAdminAuth } from "@/lib/firebase/admin";
import { rateLimit } from "@/lib/apiKeys";

// Session-revoke endpoint (issue #185, epic #186). Lets a signed-in user revoke
// all of their refresh tokens — the "sign out everywhere" escape hatch that
// bounds the device-login residual: if a proxy ever rode the resulting session,
// the user can kill it. The caller proves identity with their Firebase ID token
// (Bearer); we verify it → uid and revoke. Same-origin only.
//
// Note: revokeRefreshTokens invalidates tokens issued before now; existing ID
// tokens stay valid until they expire (~1h) unless verified with checkRevoked.
// The client signs out locally for immediate effect on the current device.

export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}
function err(error: string, description: string, status: number): Response {
  return Response.json({ error, error_description: description }, { status });
}

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`auth:sessions:revoke:${clientIp(req)}`, { max: 20, windowMs: 60 * 60 * 1000 })) {
    return err("rate_limited", "Too many requests; try again later.", 429);
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) return err("invalid_request", "Missing bearer ID token.", 401);

  const adminAuth = getAdminAuth();
  if (!adminAuth) return err("server_error", "Auth is not configured.", 503);

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(match[1])).uid;
  } catch {
    return err("access_denied", "Invalid or expired Firebase ID token.", 401);
  }

  try {
    await adminAuth.revokeRefreshTokens(uid);
  } catch (e) {
    console.error("[auth/sessions/revoke] revokeRefreshTokens failed", e);
    return err("server_error", "Could not revoke sessions.", 503);
  }
  return Response.json({ revoked: true });
}
