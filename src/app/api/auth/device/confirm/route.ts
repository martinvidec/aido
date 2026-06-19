import { getAdminAuth } from "@/lib/firebase/admin";
import { rateLimit } from "@/lib/apiKeys";
import { approveDeviceLogin, denyDeviceLogin } from "@/lib/auth/deviceLogin";

// Device-login confirm endpoint (issue #180, epic #186). Called from the /device
// consent page on the trusted second device: the user is signed in with the
// existing Firebase Google login and posts their ID token + the user_code shown
// on the work machine. We verify the ID token → uid (like the OAuth confirm) and
// approve/deny the pending device-login code. The work machine's poller then
// receives a Firebase custom token (issue #181). Same-origin only (no CORS).

export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}
function err(error: string, description: string, status: number): Response {
  return Response.json({ error, error_description: description }, { status });
}

export async function POST(req: Request): Promise<Response> {
  // Rate-limit per IP to blunt user_code guessing (codes are short-lived + high
  // entropy, so this is defence in depth).
  if (!rateLimit(`device-login:confirm:${clientIp(req)}`, { max: 60, windowMs: 60 * 60 * 1000 })) {
    return err("rate_limited", "Too many confirmation attempts; try again later.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("invalid_request", "Invalid JSON body.", 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const idToken = str(b.idToken);
  const userCode = str(b.userCode);
  const action = str(b.action);

  if (!idToken || !userCode) return err("invalid_request", "Missing idToken or userCode.", 400);
  if (action !== "approve" && action !== "deny") {
    return err("invalid_request", "action must be 'approve' or 'deny'.", 400);
  }

  const adminAuth = getAdminAuth();
  if (!adminAuth) return err("server_error", "Auth is not configured.", 503);

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(idToken)).uid;
  } catch {
    return err("access_denied", "Invalid or expired Firebase ID token.", 401);
  }

  const ok = action === "approve" ? await approveDeviceLogin(userCode, uid) : await denyDeviceLogin(userCode);
  if (!ok) {
    return err("invalid_request", "Unknown, expired or already-decided user_code.", 400);
  }
  return Response.json({ status: action === "approve" ? "approved" : "denied" });
}
