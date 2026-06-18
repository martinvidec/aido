import { rateLimit } from "@/lib/apiKeys";
import { createClient } from "@/lib/oauth/store";

// Dynamic Client Registration (RFC 7591, issue #152). claude.ai registers
// itself by POSTing its redirect_uris; we return a client_id. Public client
// (PKCE), so no client_secret. Uses Web Request/Response (no next/server) so the
// handler is testable in isolation.

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

function isValidRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || !uri) return false;
  try {
    const u = new URL(uri);
    // http(s) only, no fragment (RFC 6749 §3.1.2).
    return (u.protocol === "https:" || u.protocol === "http:") && u.hash === "";
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`oauth:register:${clientIp(req)}`, { max: 20, windowMs: 60 * 60 * 1000 })) {
    return err("rate_limited", "Too many registrations; try again later.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("invalid_client_metadata", "Invalid JSON body.", 400);
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const redirectUris = b.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    !redirectUris.every(isValidRedirectUri)
  ) {
    return err(
      "invalid_redirect_uri",
      "redirect_uris must be a non-empty array of http(s) URIs without a fragment.",
      400
    );
  }
  const clientName = typeof b.client_name === "string" ? b.client_name : null;

  let client;
  try {
    client = await createClient({ redirectUris: redirectUris as string[], clientName });
  } catch (e) {
    console.error("[oauth/register] createClient failed", e);
    return err("server_error", "Registration storage is unavailable.", 503);
  }

  return Response.json(
    {
      client_id: client.clientId,
      redirect_uris: client.redirectUris,
      ...(client.clientName ? { client_name: client.clientName } : {}),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: CORS }
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
