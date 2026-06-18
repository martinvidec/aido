import { createHash, timingSafeEqual } from "node:crypto";

// PKCE S256 (issue #150): the authorize step stores `code_challenge`; the token
// step must present a `code_verifier` whose base64url(SHA-256) equals it. S256
// only — `plain` is not accepted. Timing-safe comparison.
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
