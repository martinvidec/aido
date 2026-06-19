import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";

// Device-login store (issue #177, epic #186). Backs a web-UI login over a second
// device, modelled on RFC 8628: the work machine starts a flow and polls; the
// user approves on a trusted device. The completion artifact is a Firebase custom
// token (minted by the poll route), so the Google login never crosses the work
// (proxy) channel.
//
// The `deviceLoginCodes` collection is denied to all clients in firestore.rules
// and is only ever touched here (Admin SDK). The doc id is sha256(device_code) —
// the opaque code is never stored in the clear (like oauthRefreshTokens). The
// short `user_code` is an indexed field for the approve/deny lookup.

export const DEVICE_LOGIN = {
  collection: "deviceLoginCodes",
  ttlSec: 5 * 60, // keep short — the custom-token residual is bounded by this
  pollIntervalSec: 5, // RFC 8628 default
  userCodeAlphabet: "BCDFGHJKLMNPQRSTVWXZ", // no vowels, no 0/O/1/I — unambiguous
  userCodeLength: 8, // displayed grouped as "XXXX-XXXX"
} as const;

function db() {
  const d = getAdminDb();
  if (!d) {
    throw new Error("Device-login store requires the Admin SDK (FIREBASE_SERVICE_ACCOUNT_KEY).");
  }
  return d;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// A fresh, unambiguous user code (canonical form: uppercase, no separator).
function generateUserCode(): string {
  const a = DEVICE_LOGIN.userCodeAlphabet;
  let out = "";
  for (let i = 0; i < DEVICE_LOGIN.userCodeLength; i++) out += a[randomInt(a.length)];
  return out;
}

/** Display form of a canonical user code, e.g. "WDJBMJHT" → "WDJB-MJHT". */
export function formatUserCode(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}

/** Canonicalise user input (strip separators/whitespace, uppercase) for lookup. */
export function normalizeUserCode(input: string): string {
  return (input || "").toUpperCase().replace(/[\s-]/g, "");
}

export interface DeviceLoginStart {
  deviceCode: string;
  userCode: string; // display form ("XXXX-XXXX")
  expiresIn: number;
  interval: number;
}

export async function createDeviceLogin(): Promise<DeviceLoginStart> {
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = generateUserCode();
  await db().collection(DEVICE_LOGIN.collection).doc(sha256(deviceCode)).set({
    userCode,
    status: "pending",
    uid: null,
    interval: DEVICE_LOGIN.pollIntervalSec,
    lastPolledAt: 0,
    expiresAt: Date.now() + DEVICE_LOGIN.ttlSec * 1000,
    createdAt: FieldValue.serverTimestamp(),
  });
  return {
    deviceCode,
    userCode: formatUserCode(userCode),
    expiresIn: DEVICE_LOGIN.ttlSec,
    interval: DEVICE_LOGIN.pollIntervalSec,
  };
}

// Set a pending code's status. Atomic: only succeeds if the code exists, is
// unexpired and still pending. Returns false otherwise (unknown/expired/decided).
async function decideDeviceLogin(
  userCode: string,
  update: { status: "approved"; uid: string } | { status: "denied" }
): Promise<boolean> {
  const canonical = normalizeUserCode(userCode);
  if (!canonical) return false;
  const d = db();
  const q = d.collection(DEVICE_LOGIN.collection).where("userCode", "==", canonical).limit(1);
  return d.runTransaction(async (tx) => {
    const snap = await tx.get(q);
    if (snap.empty) return false;
    const doc = snap.docs[0];
    const data = doc.data();
    if (data.status !== "pending" || typeof data.expiresAt !== "number" || data.expiresAt < Date.now()) {
      return false;
    }
    tx.update(doc.ref, update);
    return true;
  });
}

export function approveDeviceLogin(userCode: string, uid: string): Promise<boolean> {
  if (!uid) return Promise.resolve(false);
  return decideDeviceLogin(userCode, { status: "approved", uid });
}

export function denyDeviceLogin(userCode: string): Promise<boolean> {
  return decideDeviceLogin(userCode, { status: "denied" });
}

export type DeviceLoginPoll =
  | { kind: "pending" | "slow_down" | "denied" | "expired" }
  | { kind: "approved"; uid: string };

// Poll a device code. Returns the current state; `approved` is single-use — it
// consumes (deletes) the code in the same transaction so a replay yields
// `expired`. `slow_down` is only signalled while still pending (a variant of
// authorization_pending per RFC 8628 §3.5); once approved the token is delivered
// regardless of poll cadence.
export async function pollDeviceLogin(deviceCode: string): Promise<DeviceLoginPoll> {
  if (!deviceCode) return { kind: "expired" };
  const ref = db().collection(DEVICE_LOGIN.collection).doc(sha256(deviceCode));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "expired" } as const;
    const d = snap.data()!;
    const now = Date.now();
    if (typeof d.expiresAt !== "number" || d.expiresAt < now) {
      tx.delete(ref);
      return { kind: "expired" } as const;
    }
    if (d.status === "approved" && typeof d.uid === "string") {
      tx.delete(ref); // single-use
      return { kind: "approved", uid: d.uid } as const;
    }
    if (d.status === "denied") return { kind: "denied" } as const;
    // pending: enforce the polling interval
    const interval = typeof d.interval === "number" ? d.interval : DEVICE_LOGIN.pollIntervalSec;
    const last = typeof d.lastPolledAt === "number" ? d.lastPolledAt : 0;
    if (last > 0 && now - last < interval * 1000) {
      return { kind: "slow_down" } as const;
    }
    tx.update(ref, { lastPolledAt: now });
    return { kind: "pending" } as const;
  });
}
