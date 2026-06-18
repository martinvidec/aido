import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getPublicOrigin } from "mcp-handler";
import { getAdminDb } from "@/lib/firebase/admin";
import { API_KEYS_COLLECTION, hashApiKey, looksLikeApiKey } from "@/lib/apiKeys";
import { verifyAccessToken } from "@/lib/oauth/tokens";
import { requestOrigin, resourceUrl } from "@/lib/oauth/config";

// Guards the MCP endpoint. Two accepted credentials:
// 1. the shared secret MCP_AUTH_TOKEN (ops/back-compat) — carries NO user
//    identity, so it can authorize the transport but not per-user data tools.
// 2. a personal API key (aido_…, issue #21) — verified by SHA-256 hash lookup
//    in userApiKeys via the Admin SDK; resolves to the owner's uid (the doc id).
// With neither mechanism configured all requests are rejected (503).

// Who authenticated. `user` carries the uid the personal key belongs to and is
// what the Firestore-backed data tools scope every read/write to (issue #117);
// `shared` is the identity-less shared-secret caller (data tools reject it).
export type McpPrincipal = { kind: "user"; uid: string } | { kind: "shared" };

export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; response: NextResponse };

function matchesSharedSecret(provided: string): boolean {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) return false;
  const providedBuf = Buffer.from(provided);
  const secretBuf = Buffer.from(expected);
  return providedBuf.length === secretBuf.length && timingSafeEqual(providedBuf, secretBuf);
}

// Resolves a personal API key to its owner's uid, or null if it isn't a valid
// key. The userApiKeys doc id IS the uid, so a hash match yields the uid directly.
async function resolvePersonalApiKey(provided: string): Promise<string | null> {
  if (!looksLikeApiKey(provided)) return null;
  const db = getAdminDb();
  if (!db) return null;

  const snapshot = await db
    .collection(API_KEYS_COLLECTION)
    .where("keyHash", "==", hashApiKey(provided))
    .limit(1)
    .get();
  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  // Best-effort usage timestamp; auth must not fail on a metadata write.
  doc.ref.update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});
  return doc.id; // doc id === uid
}

// Verifies an OAuth access token (issue #155): a JWT signed by aido's token
// endpoint. iss/aud are derived from the request origin — identical to how the
// token endpoint signed them (config.requestOrigin), so they line up. Non-JWTs
// (shared secret / personal key, handled earlier) and any verification failure
// return null.
async function resolveOAuthToken(token: string, req: NextRequest): Promise<string | null> {
  if (!token.includes(".")) return null;
  const origin = requestOrigin(req);
  try {
    const { uid } = await verifyAccessToken(token, { issuer: origin, audience: resourceUrl(origin) });
    return uid;
  } catch {
    return null;
  }
}

// Authenticates an MCP request and returns the principal (issue #117). Data
// tools branch on `principal.kind`: only `user` exposes a uid to scope to.
export async function authenticateMcp(req: NextRequest): Promise<McpAuthResult> {
  if (!process.env.MCP_AUTH_TOKEN && !getAdminDb()) {
    console.error("Neither MCP_AUTH_TOKEN nor Firebase Admin is configured; rejecting MCP request.");
    return {
      ok: false,
      response: NextResponse.json({ error: "MCP endpoint is not configured" }, { status: 503 }),
    };
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  if (match) {
    const provided = match[1];
    // Shared secret first: it never looks like a personal key, so this avoids a
    // Firestore lookup for shared-secret callers.
    if (matchesSharedSecret(provided)) return { ok: true, principal: { kind: "shared" } };
    const uid = await resolvePersonalApiKey(provided);
    if (uid) return { ok: true, principal: { kind: "user", uid } };
    // OAuth access token (issue #155): a JWT from aido's token endpoint — this is
    // how the claude.ai web connector authenticates.
    const oauthUid = await resolveOAuthToken(provided, req);
    if (oauthUid) return { ok: true, principal: { kind: "user", uid: oauthUid } };
  }

  // 401 with a WWW-Authenticate that points at the protected-resource metadata
  // (issue #151), so an OAuth-capable client (claude.ai connector) can discover
  // the Authorization Server. API-key/shared-token clients ignore the header.
  const resourceMetadataUrl = `${getPublicOrigin(req)}/.well-known/oauth-protected-resource`;
  return {
    ok: false,
    response: NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"` },
      }
    ),
  };
}

// Back-compat transport guard: returns null if authorized, else the error
// response. The endpoint handlers (POST/GET/DELETE) use this for transport-level
// auth; the per-user data tools will call authenticateMcp directly to get the uid.
export async function requireMcpAuth(req: NextRequest): Promise<NextResponse | null> {
  const result = await authenticateMcp(req);
  return result.ok ? null : result.response;
}
