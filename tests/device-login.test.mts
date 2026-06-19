// Integration tests for the device-login store (issue #177, epic #186).
// Exercises the REAL code (src/lib/auth/deviceLogin.ts) against the Firestore
// emulator with the Admin SDK — create / poll (pending, slow_down, approved,
// single-use, expired) / approve / deny.
//
// Run via (needs a JDK + the firestore emulator):
//   npx -y firebase-tools@13 emulators:exec --only firestore --project demo-device-login \
//     "node --conditions=react-server --import tsx tests/device-login.test.mts"
// (react-server condition neutralises the `server-only` guard; tsx resolves @/*.)

import { initializeApp } from "firebase-admin/app";
import { createHash } from "node:crypto";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is not set — run inside emulators:exec.");
  process.exit(1);
}

// Pre-init the app under the name admin.ts expects, so getAdminDb() reuses this
// emulator-bound app and never goes through cert().
const projectId = process.env.GCLOUD_PROJECT || "demo-device-login";
initializeApp({ projectId }, "admin");

const store = await import("../src/lib/auth/deviceLogin.ts");
const { getAdminDb } = await import("../src/lib/firebase/admin.ts");
const { POST: startPost } = await import("../src/app/api/auth/device/start/route.ts");
const { POST: confirmPost } = await import("../src/app/api/auth/device/confirm/route.ts");
const { POST: pollPost } = await import("../src/app/api/auth/device/poll/route.ts");
const { POST: revokePost } = await import("../src/app/api/auth/sessions/revoke/route.ts");
const { getAdminAuth } = await import("../src/lib/firebase/admin.ts");

function revokeReq(bearer: string | null, ip = "10.0.0.1"): Request {
  return new Request("https://aido.example/api/auth/sessions/revoke", {
    method: "POST",
    headers: bearer
      ? { authorization: `Bearer ${bearer}`, "x-forwarded-for": ip }
      : { "x-forwarded-for": ip },
  });
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function pollReq(deviceCode: unknown, ip = "7.0.0.1"): Request {
  return new Request("https://aido.example/api/auth/device/poll", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ device_code: deviceCode }),
  });
}

// Exchange a custom token for an ID token via the Auth emulator REST API,
// proving the token actually establishes a session.
async function exchangeCustomToken(customToken: string): Promise<string | null> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { idToken?: string };
  return data.idToken ?? null;
}

function startReq(ip = "5.0.0.1"): Request {
  return new Request("https://aido.example/api/auth/device/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, "x-forwarded-host": "aido.example", "x-forwarded-proto": "https" },
  });
}

function confirmReq(bodyObj: unknown, ip = "6.0.0.1"): Request {
  return new Request("https://aido.example/api/auth/device/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(bodyObj),
  });
}

// Mint a real emulator Firebase ID token via the Auth emulator REST API.
async function mintIdToken(): Promise<{ idToken: string; uid: string }> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) }
  );
  const data = (await res.json()) as { idToken: string; localId: string };
  return { idToken: data.idToken, uid: data.localId };
}

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

async function run() {
  // --- create: shape + display formatting ---
  const started = await store.createDeviceLogin();
  check(
    "create → deviceCode + formatted userCode + ttl/interval",
    typeof started.deviceCode === "string" &&
      started.deviceCode.length > 0 &&
      /^[A-Z]{4}-[A-Z]{4}$/.test(started.userCode) &&
      started.expiresIn === store.DEVICE_LOGIN.ttlSec &&
      started.interval === store.DEVICE_LOGIN.pollIntervalSec
  );

  // --- poll: pending, then slow_down on a too-fast second poll ---
  const p1 = await store.pollDeviceLogin(started.deviceCode);
  check("poll #1 → pending", p1.kind === "pending");
  const p2 = await store.pollDeviceLogin(started.deviceCode);
  check("poll #2 (too fast) → slow_down", p2.kind === "slow_down");

  // --- approve via the hyphenated display form (normalize), then approved+uid ---
  const approved = await store.approveDeviceLogin(started.userCode, "uid-123");
  check("approveDeviceLogin (display form) → true", approved === true);
  const p3 = await store.pollDeviceLogin(started.deviceCode);
  check("poll after approve → approved + uid (interval ignored once approved)", p3.kind === "approved" && (p3 as { uid: string }).uid === "uid-123");

  // --- single-use: a second poll after consumption → expired ---
  const p4 = await store.pollDeviceLogin(started.deviceCode);
  check("poll after consume → expired (single-use)", p4.kind === "expired");

  // --- approving an already-decided/consumed code → false ---
  check("approve consumed code → false", (await store.approveDeviceLogin(started.userCode, "uid-x")) === false);

  // --- unknowns ---
  check("poll unknown deviceCode → expired", (await store.pollDeviceLogin("does-not-exist")).kind === "expired");
  check("approve unknown userCode → false", (await store.approveDeviceLogin("ZZZZ-ZZZZ", "uid-y")) === false);
  check("approve empty uid → false", (await store.approveDeviceLogin(started.userCode, "")) === false);

  // --- deny flow ---
  const d = await store.createDeviceLogin();
  check("deny → true", (await store.denyDeviceLogin(d.userCode)) === true);
  check("poll after deny → denied", (await store.pollDeviceLogin(d.deviceCode)).kind === "denied");
  check("approve after deny → false", (await store.approveDeviceLogin(d.userCode, "uid-z")) === false);

  // --- TTL expiry: backdate expiresAt directly, then poll → expired + cleaned up ---
  const e = await store.createDeviceLogin();
  const ref = getAdminDb()!.collection(store.DEVICE_LOGIN.collection).doc(sha256(e.deviceCode));
  await ref.update({ expiresAt: Date.now() - 1000 });
  check("poll expired code → expired", (await store.pollDeviceLogin(e.deviceCode)).kind === "expired");
  check("expired code is deleted", !(await ref.get()).exists);

  // --- approving an expired code → false ---
  const e2 = await store.createDeviceLogin();
  await getAdminDb()!
    .collection(store.DEVICE_LOGIN.collection)
    .doc(sha256(e2.deviceCode))
    .update({ expiresAt: Date.now() - 1000 });
  check("approve expired code → false", (await store.approveDeviceLogin(e2.userCode, "uid-e")) === false);

  // --- start endpoint (issue #179): shape + verification URIs, then rate limit ---
  const sRes = await startPost(startReq("5.0.0.1"));
  const s = (await sRes.json()) as {
    device_code?: string; user_code?: string;
    verification_uri?: string; verification_uri_complete?: string;
    expires_in?: number; interval?: number;
  };
  check(
    "start → 200 with device_code + formatted user_code + ttl/interval",
    sRes.status === 200 &&
      typeof s.device_code === "string" && s.device_code!.length > 0 &&
      /^[A-Z]{4}-[A-Z]{4}$/.test(s.user_code ?? "") &&
      s.expires_in === store.DEVICE_LOGIN.ttlSec &&
      s.interval === store.DEVICE_LOGIN.pollIntervalSec
  );
  check(
    "start → verification_uri(_complete) honour the forwarded origin + user_code",
    s.verification_uri === "https://aido.example/device" &&
      s.verification_uri_complete === `https://aido.example/device?user_code=${encodeURIComponent(s.user_code!)}`
  );
  // the started code is real: poll it → pending
  check("start → device_code is pollable (pending)", (await store.pollDeviceLogin(s.device_code!)).kind === "pending");

  // rate limit: a fresh IP, 30 allowed then 429 (max 30 / window)
  let limited = false;
  for (let i = 0; i < 32; i++) {
    const r = await startPost(startReq("5.9.9.9"));
    if (r.status === 429) { limited = true; break; }
  }
  check("start → rate-limited after the per-IP cap", limited);

  // --- confirm endpoint (issue #180): approve binds the real uid; poll → approved ---
  const ca = await store.createDeviceLogin();
  const { idToken, uid } = await mintIdToken();
  const caRes = await confirmPost(confirmReq({ idToken, userCode: ca.userCode, action: "approve" }));
  const caJson = (await caRes.json()) as { status?: string };
  check("confirm approve → 200 {status: approved}", caRes.status === 200 && caJson.status === "approved");
  const caPoll = await store.pollDeviceLogin(ca.deviceCode);
  check("confirm approve binds the real uid", caPoll.kind === "approved" && (caPoll as { uid: string }).uid === uid);

  // deny
  const cd = await store.createDeviceLogin();
  const cdRes = await confirmPost(confirmReq({ idToken, userCode: cd.userCode, action: "deny" }));
  check("confirm deny → 200 {status: denied}", cdRes.status === 200 && ((await cdRes.json()) as { status?: string }).status === "denied");
  check("confirm deny → poll denied", (await store.pollDeviceLogin(cd.deviceCode)).kind === "denied");

  // error cases
  const cerr = await store.createDeviceLogin();
  check("confirm invalid id token → 401", (await confirmPost(confirmReq({ idToken: "not-a-token", userCode: cerr.userCode, action: "approve" }))).status === 401);
  check("confirm unknown user_code → 400", (await confirmPost(confirmReq({ idToken, userCode: "ZZZZ-ZZZZ", action: "approve" }))).status === 400);
  check("confirm missing fields → 400", (await confirmPost(confirmReq({ idToken, action: "approve" }))).status === 400);
  check("confirm bad action → 400", (await confirmPost(confirmReq({ idToken, userCode: cerr.userCode, action: "frobnicate" }))).status === 400);

  // --- poll endpoint (issue #181): RFC error codes, then custom token on approve ---
  const pf = await store.createDeviceLogin();
  const pPending = await pollPost(pollReq(pf.deviceCode));
  check("poll pending → 400 authorization_pending", pPending.status === 400 && ((await pPending.json()) as { error?: string }).error === "authorization_pending");
  const pSlow = await pollPost(pollReq(pf.deviceCode));
  check("poll too fast → 400 slow_down", pSlow.status === 400 && ((await pSlow.json()) as { error?: string }).error === "slow_down");
  check("poll missing device_code → 400 invalid_request", ((await (await pollPost(pollReq(undefined))).json()) as { error?: string }).error === "invalid_request");
  check("poll unknown device_code → 400 expired_token", ((await (await pollPost(pollReq("nope"))).json()) as { error?: string }).error === "expired_token");

  // approve via confirm, then poll → custom token that actually signs in
  const { idToken: pIdToken, uid: pUid } = await mintIdToken();
  await confirmPost(confirmReq({ idToken: pIdToken, userCode: pf.userCode, action: "approve" }));
  const pOk = await pollPost(pollReq(pf.deviceCode));
  const pJson = (await pOk.json()) as { firebaseCustomToken?: string };
  check("poll approved → 200 firebaseCustomToken", pOk.status === 200 && typeof pJson.firebaseCustomToken === "string" && pJson.firebaseCustomToken!.length > 0);
  const exchangedIdToken = pJson.firebaseCustomToken ? await exchangeCustomToken(pJson.firebaseCustomToken) : null;
  const exchangedUid = exchangedIdToken ? (await getAdminAuth()!.verifyIdToken(exchangedIdToken)).uid : null;
  check("poll custom token signs in as the approving uid", exchangedUid === pUid);
  check("poll after consume → 400 expired_token (single-use)", ((await (await pollPost(pollReq(pf.deviceCode))).json()) as { error?: string }).error === "expired_token");

  // denied flow surfaces access_denied
  const pd = await store.createDeviceLogin();
  await store.denyDeviceLogin(pd.userCode);
  check("poll denied → 400 access_denied", ((await (await pollPost(pollReq(pd.deviceCode))).json()) as { error?: string }).error === "access_denied");

  // === issue #184: cohesive end-to-end, ONLY over the HTTP endpoints ===
  // start → poll(pending) → poll(slow_down) → confirm(approve) → poll(custom
  // token) → exchange→verify uid → poll(single-use → expired). No direct store
  // calls — proves the endpoints compose as a black box.
  {
    const sRes = await startPost(startReq("8.0.0.1"));
    const s = (await sRes.json()) as { device_code: string; user_code: string };
    check("e2e: start → device_code + user_code", !!s.device_code && /^[A-Z]{4}-[A-Z]{4}$/.test(s.user_code));

    const e1 = (await (await pollPost(pollReq(s.device_code, "8.0.0.1"))).json()) as { error?: string };
    check("e2e: poll #1 → authorization_pending", e1.error === "authorization_pending");
    const e2 = (await (await pollPost(pollReq(s.device_code, "8.0.0.1"))).json()) as { error?: string };
    check("e2e: poll #2 (fast) → slow_down", e2.error === "slow_down");

    const { idToken: e2eIdToken, uid: e2eUid } = await mintIdToken();
    const cRes = await confirmPost(confirmReq({ idToken: e2eIdToken, userCode: s.user_code, action: "approve" }, "8.0.0.2"));
    check("e2e: confirm(approve) on the trusted device → approved", cRes.status === 200 && ((await cRes.json()) as { status?: string }).status === "approved");

    const tokRes = await pollPost(pollReq(s.device_code, "8.0.0.1"));
    const tok = (await tokRes.json()) as { firebaseCustomToken?: string };
    check("e2e: poll after approve → custom token", tokRes.status === 200 && !!tok.firebaseCustomToken);

    const idToken = tok.firebaseCustomToken ? await exchangeCustomToken(tok.firebaseCustomToken) : null;
    const signedInUid = idToken ? (await getAdminAuth()!.verifyIdToken(idToken)).uid : null;
    check("e2e: custom token establishes a session as the approver", signedInUid === e2eUid);

    const after = (await (await pollPost(pollReq(s.device_code, "8.0.0.1"))).json()) as { error?: string };
    check("e2e: re-poll after sign-in → expired_token (single-use)", after.error === "expired_token");
  }

  // === issue #184: end-to-end deny, ONLY over the HTTP endpoints ===
  {
    const sRes = await startPost(startReq("9.0.0.1"));
    const s = (await sRes.json()) as { device_code: string; user_code: string };
    const { idToken: dIdToken } = await mintIdToken();
    await confirmPost(confirmReq({ idToken: dIdToken, userCode: s.user_code, action: "deny" }, "9.0.0.2"));
    const denied = (await (await pollPost(pollReq(s.device_code, "9.0.0.1"))).json()) as { error?: string };
    check("e2e(deny): poll after deny → access_denied", denied.error === "access_denied");
  }

  // --- session revoke endpoint (issue #185) ---
  const { idToken: revIdToken } = await mintIdToken();
  const revOk = await revokePost(revokeReq(revIdToken));
  check("revoke valid id token → 200 {revoked}", revOk.status === 200 && ((await revOk.json()) as { revoked?: boolean }).revoked === true);
  check("revoke missing bearer → 401", (await revokePost(revokeReq(null))).status === 401);
  check("revoke invalid id token → 401", (await revokePost(revokeReq("not-a-token"))).status === 401);
}

run()
  .then(() => {
    console.log(failures === 0 ? "\nAll device-login store tests passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("\nTest run crashed:", e);
    process.exit(1);
  });
