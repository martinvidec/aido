import { getAdminAuth } from "@/lib/firebase/admin";
import { rateLimit } from "@/lib/apiKeys";
import { pollDeviceLogin } from "@/lib/auth/deviceLogin";

// Device-login poll endpoint (issue #181, epic #186). The work-machine UI polls
// this with its device_code. Until the user approves on the trusted device it
// gets authorization_pending / slow_down (RFC 8628 §3.5 error codes); once
// approved it receives a Firebase custom token, which the UI hands to
// signInWithCustomToken to establish a real web session — so the Google login
// never crosses the work (proxy) channel. The approved code is single-use
// (consumed by pollDeviceLogin). Same-origin only (no CORS).

export const dynamic = "force-dynamic";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}
function err(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  // Generous per-IP cap: a flow polls ~once per `interval` for up to the TTL.
  if (!rateLimit(`device-login:poll:${clientIp(req)}`, { max: 300, windowMs: 60 * 60 * 1000 })) {
    return err("slow_down", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("invalid_request", 400);
  }
  const deviceCode = str((body as Record<string, unknown> | null)?.device_code);
  if (!deviceCode) return err("invalid_request", 400);

  // Check Auth availability before polling, so a misconfigured server doesn't
  // consume an approved code it then can't turn into a token.
  const adminAuth = getAdminAuth();
  if (!adminAuth) return err("server_error", 503);

  let result;
  try {
    result = await pollDeviceLogin(deviceCode);
  } catch (e) {
    console.error("[auth/device/poll] poll failed", e);
    return err("server_error", 503);
  }

  switch (result.kind) {
    case "pending":
      return err("authorization_pending", 400);
    case "slow_down":
      return err("slow_down", 400);
    case "denied":
      return err("access_denied", 400);
    case "expired":
      return err("expired_token", 400);
    case "approved": {
      let customToken: string;
      try {
        customToken = await adminAuth.createCustomToken(result.uid);
      } catch (e) {
        console.error("[auth/device/poll] createCustomToken failed", e);
        return err("server_error", 503);
      }
      return Response.json(
        { firebaseCustomToken: customToken },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  }
}
