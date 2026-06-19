import { rateLimit } from "@/lib/apiKeys";
import { createDeviceLogin } from "@/lib/auth/deviceLogin";
import { requestOrigin } from "@/lib/oauth/config";

// Device-login start endpoint (issue #179, epic #186). The unauthenticated web UI
// on the work machine calls this to begin a second-device login (RFC 8628-style):
// it returns a short user_code + a verification URL/QR target. The actual Google
// login + consent happen on a trusted device via /device; the work machine then
// polls /api/auth/device/poll. Same-origin only (no CORS) — this is aido's own UI.

export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

function err(error: string, description: string, status: number): Response {
  return Response.json({ error, error_description: description }, { status });
}

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`device-login:start:${clientIp(req)}`, { max: 30, windowMs: 60 * 60 * 1000 })) {
    return err("rate_limited", "Too many device-login requests; try again later.", 429);
  }

  let started;
  try {
    started = await createDeviceLogin();
  } catch (e) {
    console.error("[auth/device/start] createDeviceLogin failed", e);
    return err("server_error", "Device-login storage is unavailable.", 503);
  }

  const origin = requestOrigin(req);
  const verificationUri = `${origin}/device`;
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(started.userCode)}`;

  return Response.json(
    {
      device_code: started.deviceCode,
      user_code: started.userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: started.expiresIn,
      interval: started.interval,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
