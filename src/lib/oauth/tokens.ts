import { SignJWT, jwtVerify } from "jose";
import { OAUTH } from "./config";

// Access tokens are short-lived JWTs signed by aido (HS256, OAUTH_SIGNING_SECRET)
// — aido is both Authorization Server and Resource Server, so a symmetric secret
// is enough. `sub` carries the uid, which is the sole authorization basis (issue
// #150). jose is imported via ESM (no CJS require), so it loads on any runtime.

function signingKey(): Uint8Array {
  const secret = process.env.OAUTH_SIGNING_SECRET;
  if (!secret) throw new Error("OAUTH_SIGNING_SECRET is not set.");
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(params: {
  issuer: string;
  audience: string;
  uid: string;
  scope: string;
  clientId: string;
  ttlSec?: number;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const ttl = params.ttlSec ?? OAUTH.accessTokenTtlSec;
  const accessToken = await new SignJWT({ scope: params.scope, client_id: params.clientId })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setIssuer(params.issuer)
    .setAudience(params.audience)
    .setSubject(params.uid)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(signingKey());
  return { accessToken, expiresIn: ttl };
}

export interface VerifiedAccessToken {
  uid: string;
  scope: string;
  clientId: string;
}

// Verifies signature + iss/aud/exp. Throws (jose error) on any failure — callers
// translate that into a 401.
export async function verifyAccessToken(
  token: string,
  expected: { issuer: string; audience: string }
): Promise<VerifiedAccessToken> {
  const { payload } = await jwtVerify(token, signingKey(), {
    issuer: expected.issuer,
    audience: expected.audience,
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Access token has no subject (uid).");
  }
  return {
    uid: payload.sub,
    scope: typeof payload.scope === "string" ? payload.scope : "",
    clientId: typeof payload.client_id === "string" ? payload.client_id : "",
  };
}
