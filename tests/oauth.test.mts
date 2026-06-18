// Integration tests for the OAuth core library (issue #150, epic #157).
// Exercises the REAL code (src/lib/oauth/*) against the Firestore emulator with
// the Admin SDK — JWT sign/verify, PKCE-S256, and the client/code/refresh stores.
//
// Run via (needs a JDK + the firestore emulator):
//   npx -y firebase-tools@13 emulators:exec --only firestore --project demo-oauth \
//     "node --conditions=react-server --import tsx tests/oauth.test.mts"
// (react-server condition neutralises the `server-only` guard; tsx resolves @/*.)

import { initializeApp } from "firebase-admin/app";
import { createHash, randomBytes } from "node:crypto";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is not set — run inside emulators:exec.");
  process.exit(1);
}

// Token signing needs a secret; set a test one if the env didn't provide it.
process.env.OAUTH_SIGNING_SECRET =
  process.env.OAUTH_SIGNING_SECRET || "test-oauth-signing-secret-at-least-32-bytes!!";

// Pre-init the app under the name admin.ts expects, so the store's getAdminDb()
// reuses this emulator-bound app and never goes through cert().
const projectId = process.env.GCLOUD_PROJECT || "demo-oauth";
initializeApp({ projectId }, "admin");

const { signAccessToken, verifyAccessToken } = await import("../src/lib/oauth/tokens.ts");
const { verifyPkceS256 } = await import("../src/lib/oauth/pkce.ts");
const store = await import("../src/lib/oauth/store.ts");

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}
async function expectReject(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failures++;
    console.error(`  ✗ ${name} (expected rejection, resolved)`);
  } catch {
    console.log(`  ✓ ${name}`);
  }
}

async function run() {
  const iss = "https://aido.example";
  const aud = "https://aido.example/api/mcp/sse";

  // --- JWT access tokens ---
  const { accessToken, expiresIn } = await signAccessToken({
    issuer: iss, audience: aud, uid: "u1", scope: "aido.tools", clientId: "c1",
  });
  const v = await verifyAccessToken(accessToken, { issuer: iss, audience: aud });
  check("jwt verify → uid/scope/client", v.uid === "u1" && v.scope === "aido.tools" && v.clientId === "c1");
  check("jwt expiresIn is the TTL", expiresIn === 3600);
  await expectReject("jwt wrong audience rejected", () => verifyAccessToken(accessToken, { issuer: iss, audience: "https://evil" }));
  await expectReject("jwt wrong issuer rejected", () => verifyAccessToken(accessToken, { issuer: "https://evil", audience: aud }));
  await expectReject("tampered jwt rejected", () => verifyAccessToken(accessToken + "x", { issuer: iss, audience: aud }));

  // --- PKCE S256 ---
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  check("pkce S256 match", verifyPkceS256(verifier, challenge) === true);
  check("pkce mismatch rejected", verifyPkceS256("not-the-verifier", challenge) === false);
  check("pkce empty rejected", verifyPkceS256("", challenge) === false);

  // --- Client store (DCR) ---
  const client = await store.createClient({ redirectUris: ["https://claude.ai/cb"], clientName: "Claude" });
  check("client has an id", typeof client.clientId === "string" && client.clientId.length > 0);
  const got = await store.getClient(client.clientId);
  check("client store roundtrip", got?.redirectUris[0] === "https://claude.ai/cb" && got?.clientName === "Claude");
  check("unknown client → null", (await store.getClient("nope")) === null);

  // --- Auth code: single-use, short-lived ---
  const code = await store.createAuthCode({
    uid: "u1", clientId: client.clientId, redirectUri: "https://claude.ai/cb", codeChallenge: challenge, scope: "aido.tools",
  });
  const c1 = await store.consumeAuthCode(code);
  check("auth code consume → data", c1?.uid === "u1" && c1?.codeChallenge === challenge);
  const c2 = await store.consumeAuthCode(code);
  check("auth code is single-use (replay → null)", c2 === null);
  check("unknown auth code → null", (await store.consumeAuthCode("nope")) === null);

  // --- Refresh token: hashed, revocable ---
  const rt = await store.createRefreshToken({ uid: "u1", clientId: client.clientId, scope: "aido.tools" });
  check("refresh token is opaque (aidor_ prefix)", rt.startsWith("aidor_"));
  const r1 = await store.consumeRefreshToken(rt);
  check("refresh consume → data", r1?.uid === "u1");
  await store.revokeRefreshToken(rt);
  const r2 = await store.consumeRefreshToken(rt);
  check("revoked refresh → null", r2 === null);
}

run()
  .then(() => {
    console.log(failures === 0 ? "\nAll OAuth core tests passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("\nTest run crashed:", e);
    process.exit(1);
  });
