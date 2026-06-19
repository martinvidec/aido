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

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function startReq(ip = "5.0.0.1"): Request {
  return new Request("https://aido.example/api/auth/device/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, "x-forwarded-host": "aido.example", "x-forwarded-proto": "https" },
  });
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
