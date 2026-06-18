import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { OAUTH } from "./config";

// Admin-SDK storage for the OAuth Authorization Server (issue #150). These three
// collections are denied to all clients in firestore.rules and are only ever
// touched here. Refresh tokens are stored hashed (like userApiKeys); auth codes
// are single-use and short-lived.

function db() {
  const d = getAdminDb();
  if (!d) {
    throw new Error("OAuth store requires the Admin SDK (FIREBASE_SERVICE_ACCOUNT_KEY).");
  }
  return d;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// --- Clients (Dynamic Client Registration) ---

export interface OAuthClient {
  clientId: string;
  redirectUris: string[];
  clientName: string | null;
}

export async function createClient(input: {
  redirectUris: string[];
  clientName?: string | null;
}): Promise<OAuthClient> {
  const clientId = randomUUID();
  await db().collection(OAUTH.collections.clients).doc(clientId).set({
    redirectUris: input.redirectUris,
    clientName: input.clientName ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { clientId, redirectUris: input.redirectUris, clientName: input.clientName ?? null };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const snap = await db().collection(OAUTH.collections.clients).doc(clientId).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    clientId: snap.id,
    redirectUris: Array.isArray(d.redirectUris) ? d.redirectUris : [],
    clientName: typeof d.clientName === "string" ? d.clientName : null,
  };
}

// --- Authorization codes (single-use, short-lived) ---

export interface AuthCodeData {
  uid: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
}

export async function createAuthCode(input: AuthCodeData): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db().collection(OAUTH.collections.codes).doc(code).set({
    ...input,
    expiresAt: Date.now() + OAUTH.authCodeTtlSec * 1000,
    used: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return code;
}

// Atomically consume a code: returns its data only if it exists, is unused and
// unexpired — and marks it used in the same transaction (so a replay returns
// null). Returns null otherwise.
export async function consumeAuthCode(code: string): Promise<AuthCodeData | null> {
  if (!code) return null;
  const ref = db().collection(OAUTH.collections.codes).doc(code);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data()!;
    if (d.used === true || typeof d.expiresAt !== "number" || d.expiresAt < Date.now()) {
      return null;
    }
    tx.update(ref, { used: true });
    return {
      uid: d.uid,
      clientId: d.clientId,
      redirectUri: d.redirectUri,
      codeChallenge: d.codeChallenge,
      scope: d.scope,
    };
  });
}

// --- Refresh tokens (opaque, hashed, revocable) ---

export interface RefreshTokenData {
  uid: string;
  clientId: string;
  scope: string;
}

export async function createRefreshToken(input: RefreshTokenData): Promise<string> {
  const token = OAUTH.refreshTokenPrefix + randomBytes(32).toString("base64url");
  await db().collection(OAUTH.collections.refreshTokens).doc(sha256(token)).set({
    ...input,
    revoked: false,
    expiresAt: Date.now() + OAUTH.refreshTokenTtlSec * 1000,
    createdAt: FieldValue.serverTimestamp(),
  });
  return token;
}

export async function consumeRefreshToken(token: string): Promise<RefreshTokenData | null> {
  if (!token) return null;
  const snap = await db().collection(OAUTH.collections.refreshTokens).doc(sha256(token)).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  if (d.revoked === true || typeof d.expiresAt !== "number" || d.expiresAt < Date.now()) {
    return null;
  }
  return { uid: d.uid, clientId: d.clientId, scope: d.scope };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  if (!token) return;
  await db()
    .collection(OAUTH.collections.refreshTokens)
    .doc(sha256(token))
    .set({ revoked: true }, { merge: true });
}
