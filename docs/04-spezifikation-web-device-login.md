# Spezifikation: Web-Login per Device-Flow (Zweitgerät-Anmeldung)

## 1. Übersicht

Neuer, additiver Anmeldeweg für die aido-Web-UI: ein Device-Flow nach
RFC-8628-Muster, dessen Abschlussartefakt ein **Firebase Custom Token** ist. Der
Arbeitsrechner zeigt Code + QR und pollt; Login und Consent erfolgen auf einem
Zweitgerät (Handy/Mobilfunk). Nach Approve erhält der Arbeitsrechner ein Custom
Token und etabliert per `signInWithCustomToken` eine vollwertige Firebase-Session.

```
Arbeitsrechner (Web-UI, hinter Proxy)     aido-Server          Handy (Mobilfunk, Trusted)
  │ ① POST /api/auth/device/start
  │ ─────────────────────────▶ erzeugt device_code + user_code (pending)
  │ ② ◀── device_code, user_code, verification_uri(_complete), expires_in, interval
  │ ③ zeigt user_code + QR an
  │                                        ④ öffnet /device (KEIN Proxy)
  │                                        ⑤ Firebase-Google-Login (sicher)
  │                                        ⑥ user_code + Erlauben
  │                            ◀──────────── POST /api/auth/device/confirm {idToken,userCode}
  │                            verifyIdToken→uid, setzt approved(uid)
  │ ⑦ POST /api/auth/device/poll {device_code}   (alle `interval` s)
  │ ◀── authorization_pending | slow_down …
  │ ⑧ ◀── { firebaseCustomToken }   nach Approve (createCustomToken), single-use
  │ ⑨ signInWithCustomToken(auth, token) → Firebase-Session → Redirect /todos
```

## 2. Technisches Design

### 2.1 Architektur

Rein additiv; bestehender Google-Login unverändert.

**Neue Endpoints**
- `POST /api/auth/device/start` — Code anfordern.
- `POST /api/auth/device/confirm` — Approve/Deny vom Zweitgerät (verifyIdToken).
- `POST /api/auth/device/poll` — Polling → Firebase Custom Token bei Approve.

**Neue/erweiterte UI**
- `GET /device` — Consent-Seite (Handy), Muster `ConsentForm.tsx`.
- `src/app/login/*` — Panel „Anmelden über Zweitgerät" (Start, Code/QR, Polling,
  `signInWithCustomToken`).

**Wiederverwendet**
- `getAdminAuth().verifyIdToken` (Confirm) — wie OAuth-Confirm (#153).
- `getAdminAuth().createCustomToken(uid)` (Poll) — neu genutzt, Admin SDK vorhanden.
- `signInWithCustomToken` (Client), `AuthProvider`-Folgeprozesse.
- `rateLimit` (`src/lib/apiKeys.ts`), `firestore.rules`-Sperrmuster.

### 2.2 Datenmodell

Neue Firestore-Collection **`deviceLoginCodes`** (nur Admin SDK). Doc-ID =
`sha256(device_code)` (Klartext-Code nicht persistiert); `userCode` als indiziertes
Feld für den Confirm-Lookup.

```
deviceLoginCodes/{sha256(device_code)}
  userCode:     string    // "WDJB-MJHT", ambig-freies Alphabet
  status:       "pending" | "approved" | "denied"
  uid:          string | null
  interval:     number     // s, Default 5
  lastPolledAt: number     // ms epoch, für slow_down
  expiresAt:    number      // ms epoch
  createdAt:    serverTimestamp
```

Konfiguration (`src/lib/auth/deviceLogin.ts`):

```ts
const DEVICE_LOGIN = {
  collection: "deviceLoginCodes",
  ttlSec: 5 * 60,                            // kurz halten (Residual!)
  pollIntervalSec: 5,
  userCodeAlphabet: "BCDFGHJKLMNPQRSTVWXZ",  // ohne Vokale/0/O/1/I
  userCodeLength: 8,                          // gruppiert "XXXX-XXXX"
} as const;
```

### 2.3 Schnittstellen

**① `POST /api/auth/device/start`** (JSON)
Response `200`:
```json
{
  "device_code": "GmRhmhc...DnyEys",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://<origin>/device",
  "verification_uri_complete": "https://<origin>/device?user_code=WDJB-MJHT",
  "expires_in": 300,
  "interval": 5
}
```

**④/⑥ `POST /api/auth/device/confirm`** (JSON, von `/device`)
Request: `{ idToken, userCode, action: "approve" | "deny" }`.
Ablauf: `verifyIdToken(idToken) → uid`; `userCode` nachschlagen (vorhanden, nicht
abgelaufen, `pending`); `approveDeviceLogin(userCode, uid)` bzw.
`denyDeviceLogin(userCode)`.
Response `{ status }`; Fehler: `access_denied` (ID-Token ungültig),
`invalid_request` (Code unbekannt/abgelaufen), `server_error` (Admin SDK fehlt).

**⑦/⑧ `POST /api/auth/device/poll`** (JSON)
Request: `{ device_code }`. Antwortmatrix:

| Zustand | Antwort |
|---|---|
| nicht existent / abgelaufen | `{ error: "expired_token" }` |
| zu schnell gepollt | `{ error: "slow_down" }` |
| `pending` | `{ error: "authorization_pending" }` |
| `denied` | `{ error: "access_denied" }` |
| `approved` | **200** `{ firebaseCustomToken }` (Code konsumiert) |

**Store-API (`src/lib/auth/deviceLogin.ts`)**
```ts
createDeviceLogin(): Promise<{ deviceCode; userCode; expiresIn; interval }>
approveDeviceLogin(userCode: string, uid: string): Promise<boolean>
denyDeviceLogin(userCode: string): Promise<boolean>
pollDeviceLogin(deviceCode: string):
  Promise<{ kind: "pending" | "slow_down" | "denied" | "expired" }
         | { kind: "approved"; uid }>
// "approved" konsumiert den Code atomar (Transaktion).
```

**⑨ Client (Login-UI)**
```ts
import { signInWithCustomToken } from "firebase/auth";
await signInWithCustomToken(auth, firebaseCustomToken); // → Session → router.push("/todos")
```

### 2.4 Sicherheits-Residual (bewusst akzeptiert)

- **Google-Credential**: nie über den Proxy (Login nur auf `/device`).
- **Custom Token / Session**: der Proxy sieht das Token in ⑧ und die Folge-
  Session; er könnte ~1 h lang selbst eine Session daraus ziehen. Schaden =
  **eine aido-Web-Session** (nicht der Google-Account), **widerrufbar** via
  `revokeRefreshTokens(uid)`. Minimierung: kurze `ttlSec`, Single-use, sofortiger
  Exchange. **DPoP ist für Firebase-Sessions nicht anwendbar** (anders als der
  MCP-Pfad #174).
- **Revoke (#185):** Für den Notfall gibt es „Auf allen Geräten abmelden" in den
  Settings → `POST /api/auth/sessions/revoke` (verifiziert das ID-Token → uid,
  `getAdminAuth().revokeRefreshTokens(uid)`). ID-Tokens bleiben bis Ablauf (~1 h)
  gültig (kein `checkRevoked` auf jedem Read); der Client meldet sich lokal sofort
  ab. TTL (5 min) + Single-use + per-IP-Rate-Limit auf confirm runden die Härtung ab.

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `src/lib/auth/deviceLogin.ts` | Store + Config (create/approve/deny/poll, `user_code`-Generator, atomarer Konsum) | Mittel |
| `firestore.rules` (+ Test) | `deviceLoginCodes` sperren | Klein |
| `src/app/api/auth/device/start/route.ts` | Start-Endpoint (+ `rateLimit`) | Klein |
| `src/app/api/auth/device/confirm/route.ts` | Confirm-Endpoint (ID-Token → uid) | Klein |
| `src/app/api/auth/device/poll/route.ts` | Poll-Endpoint (Matrix → `createCustomToken`) | Mittel |
| `src/app/device/page.tsx` + Form | Consent-Seite (Handy) | Mittel |
| `src/app/login/*` | Device-Login-Panel (Start/QR/Poll/`signInWithCustomToken`) | Mittel |
| `tests/` | Device-Login-Flow-Tests | Mittel |
| (optional) Härtung | TTL/Rate-Limit/Revoke-Doku | Klein |

### 3.2 Reihenfolge der Implementierung

1. **Store + Config** (`src/lib/auth/deviceLogin.ts`) — Fundament, isoliert testbar.
2. **firestore.rules** + Rules-Test (mit dem Datenmodell, CLAUDE.md-Vorgabe).
3. **Start-Endpoint**.
4. **Confirm-Endpoint**.
5. **Poll-Endpoint** (inkl. `createCustomToken`).
6. **`/device`-Consent-Seite** (Handy).
7. **Login-UI-Panel** am Arbeitsrechner (inkl. QR + `signInWithCustomToken`).
8. **Tests** (E2E) + manueller Durchlauf (Folgeprozesse FA-10 prüfen).
9. **(Optional)** Härtung & Revoke-Tooling.

## 4. Testplan

**Automatisiert (Emulator, `tests/`)**
- `start` liefert wohlgeformte Response (Felder, TTL, `interval`).
- `poll`: `authorization_pending` vor Approve; `slow_down` bei zu schnellem Polling.
- `confirm(approve)` → `poll` liefert `firebaseCustomToken`; Single-use (zweites
  `poll` kein Token); `expired_token` nach TTL; `deny` → `access_denied`.
- `approveDeviceLogin` mit unbekanntem/abgelaufenem `user_code` → `false`.

**Rules (`tests/firestore-rules.test.mjs`)**
- `deviceLoginCodes` für Clients weder les- noch schreibbar.

**Manuell (E2E)**
- Login-UI am Arbeitsrechner → QR scannen → Approve am Handy → Arbeitsrechner ist
  eingeloggt auf `/todos`; User-Doc/Profil/Migration laufen; Google-Login nur auf
  `/device`. Session-Revoke testen (`revokeRefreshTokens`).

## 5. Migration / Deployment

- **Keine Datenmigration** — additive Collection + Endpoints + UI.
- Reihenfolge: App zuerst (Vercel-Auto-Deploy), **danach** `firestore.rules`
  deployen (`npx -y firebase-tools@13 deploy --only firestore:rules`) — additive
  Sperrregel.
- **Env:** keine neuen Variablen; `FIREBASE_SERVICE_ACCOUNT_KEY` ist Pflicht
  (`createCustomToken` + `verifyIdToken`).

## 6. Referenzen

- [Konzeptdokument](01-konzept-web-device-login.md)
- [Ist-Analyse](02-ist-analyse-web-device-login.md)
- [Anforderungsanalyse](03-anforderungsanalyse-web-device-login.md)
- RFC 8628 — OAuth 2.0 Device Authorization Grant (UX-Muster)
- Firebase Auth — `createCustomToken` / `signInWithCustomToken`
- Verwandt: Epic #175 (OAuth-Device-Grant für MCP), `docs/04-spezifikation-oauth-device-grant.md`
