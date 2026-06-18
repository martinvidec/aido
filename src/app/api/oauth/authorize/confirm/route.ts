import { getAdminAuth } from "@/lib/firebase/admin";
import { getClient, createAuthCode } from "@/lib/oauth/store";
import { OAUTH } from "@/lib/oauth/config";

// Authorization confirm (issue #153): the consent page posts the user's Firebase
// ID token plus the OAuth request params here. We verify the ID token → uid,
// re-validate the client + redirect_uri, mint a one-time auth code, and hand the
// page the final redirect (back to the client's redirect_uri with code + state).
// Web Request/Response (no next/server) → testable in isolation.

export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function err(error: string, description: string, status: number): Response {
  return Response.json({ error, error_description: description }, { status });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("invalid_request", "Invalid JSON body.", 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const idToken = str(b.idToken);
  const clientId = str(b.clientId);
  const redirectUri = str(b.redirectUri);
  const codeChallenge = str(b.codeChallenge);
  const state = str(b.state);
  const scope = str(b.scope) || OAUTH.scope;

  if (!idToken || !codeChallenge) {
    return err("invalid_request", "Missing idToken or PKCE code_challenge.", 400);
  }

  const adminAuth = getAdminAuth();
  if (!adminAuth) return err("server_error", "Auth is not configured.", 503);

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid;
  } catch {
    return err("access_denied", "Invalid or expired Firebase ID token.", 401);
  }

  const client = await getClient(clientId).catch(() => null);
  if (!client) return err("invalid_client", "Unknown client.", 400);
  if (!client.redirectUris.includes(redirectUri)) {
    return err("invalid_request", "redirect_uri is not registered for this client.", 400);
  }

  const code = await createAuthCode({ uid, clientId, redirectUri, codeChallenge, scope });

  const sep = redirectUri.includes("?") ? "&" : "?";
  const stateParam = state ? `&state=${encodeURIComponent(state)}` : "";
  const redirectTo = `${redirectUri}${sep}code=${encodeURIComponent(code)}${stateParam}`;
  return Response.json({ redirectTo });
}
