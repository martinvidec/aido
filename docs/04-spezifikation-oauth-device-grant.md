# Spezifikation: OAuth 2.0 Device Authorization Grant (RFC 8628)

## 1. Übersicht

Der bestehende aido-Authorization-Server (Epic #157) wird um den **Device
Authorization Grant** erweitert. Ein Client auf einem unsicheren/eingeschränkten
Gerät (Arbeitsrechner hinter MITM-Proxy, CLI, headless) erhält ein aido-Access-
Token, indem Login + Consent auf einem **zweiten, vertrauenswürdigen Gerät**
erfolgen. Es werden ein neuer Endpoint, ein neuer Store, eine Consent-Seite und
ein neuer Token-Grant-Zweig ergänzt; Token-Ausstellung, Firebase-ID-Token-
Verifikation und MCP-Token-Akzeptanz werden unverändert wiederverwendet.

Vollständiger Ablauf (RFC 8628):

```
Client (Device, hinter Proxy)        aido AS              Zweitgerät (Mobilfunk, Trusted)
  │ ① POST /api/oauth/device_authorization
  │    client_id, scope
  │ ─────────────────────────▶ erzeugt device_code + user_code (pending)
  │ ② ◀── device_code, user_code, verification_uri(_complete),
  │        expires_in, interval
  │ ③ zeigt user_code + URL/QR an
  │                                        ④ öffnet /device (KEIN Proxy)
  │                                        ⑤ Firebase-Google-Login (sicher)
  │                                        ⑥ user_code eingeben + Erlauben
  │                            ◀──────────── POST /api/oauth/device/confirm
  │                            setzt approved(uid)
  │ ⑦ POST /api/oauth/token (Polling, grant_type=…device_code)
  │ ◀── authorization_pending | slow_down …
  │ ⑧ ◀── access_token (+ refresh_token)   nach Approve, device_code single-use
```

## 2. Technisches Design

### 2.1 Architektur

Additive Erweiterung; keine Änderung an `authorization_code`/`refresh_token`.

**Neue Endpoints**
- `POST /api/oauth/device_authorization` — Device Authorization Endpoint.
- `POST /api/oauth/device/confirm` — Approve/Deny vom Zweitgerät.
- Seite `GET /device` — `user_code`-Eingabe + Login + Consent (Client-Komponente
  analog `ConsentForm.tsx`).

**Erweiterte Endpoints**
- `POST /api/oauth/token` — neuer Grant-Zweig `device_code`.
- `/.well-known/oauth-authorization-server` — Endpoint + Grant-Type ergänzt.
- `POST /api/oauth/register` — `redirect_uris` für Device-Clients optional (FA-10).

**Wiederverwendet (unverändert)**
- `signAccessToken` / `issueTokens` (Access-JWT + Refresh-Rotation).
- `verifyIdToken` (Firebase-ID-Token → uid), wie in `authorize/confirm`.
- `src/lib/mcp/auth.ts` akzeptiert das Ergebnis-Token bereits (`resolveOAuthToken`).
- `rateLimit` aus `src/lib/apiKeys.ts`.

### 2.2 Datenmodell

Neue Firestore-Collection **`oauthDeviceCodes`**, ausschließlich über den
Admin-SDK-Store beschrieben. Doc-ID = SHA-256(`device_code`) (analog Refresh-
Tokens — der `device_code` selbst wird nicht im Klartext persistiert). Der
`user_code` wird als indiziertes Feld geführt (Lookup per Gleichheit).

```
oauthDeviceCodes/{sha256(device_code)}
  userCode:     string   // kurzes, ambig-freies Code-Format, z.B. "WDJB-MJHT"
  clientId:     string
  scope:        string    // default OAUTH.scope ("aido.tools")
  status:       "pending" | "approved" | "denied"
  uid:          string | null   // gesetzt bei approve
  interval:     number    // Sekunden (Default 5)
  lastPolledAt: number    // ms epoch, für slow_down
  expiresAt:    number    // ms epoch
  createdAt:    serverTimestamp
```

`config.ts`-Ergänzung:

```ts
export const OAUTH = {
  collections: {
    clients: "oauthClients",
    codes: "oauthCodes",
    refreshTokens: "oauthRefreshTokens",
    deviceCodes: "oauthDeviceCodes",          // neu
  },
  // … bestehend …
  deviceCodeTtlSec: 10 * 60,                   // 10 min
  devicePollIntervalSec: 5,                    // RFC 8628 Default
  userCodeAlphabet: "BCDFGHJKLMNPQRSTVWXZ",    // ohne Vokale/0/O/1/I
  userCodeLength: 8,                           // gruppiert "XXXX-XXXX"
} as const;
```

### 2.3 Schnittstellen

**① `POST /api/oauth/device_authorization`** (form-encoded, RFC 8628 §3.1/§3.2)

Request: `client_id`, optional `scope`.
Response `200`:
```json
{
  "device_code": "GmRhmhc...DnyEys",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://<origin>/device",
  "verification_uri_complete": "https://<origin>/device?user_code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5
}
```
Fehler: `invalid_client` (unbekannte `client_id`), `rate_limited`.

**④/⑥ `POST /api/oauth/device/confirm`** (JSON, intern von `/device`)

Request: `{ idToken, userCode, action: "approve" | "deny" }`.
Ablauf: `verifyIdToken(idToken)` → uid; `userCode` nachschlagen (existiert,
nicht abgelaufen, `pending`); Status auf `approved`+uid bzw. `denied` setzen.
Response `200`: `{ status: "approved" | "denied" }`.
Fehler: `access_denied` (ID-Token ungültig), `invalid_request` (Code unbekannt/
abgelaufen), `server_error` (Admin SDK fehlt).

**⑦/⑧ `POST /api/oauth/token`** — neuer Zweig:
```
grant_type=urn:ietf:params:oauth:grant-type:device_code
device_code=<…>
client_id=<…>
```
Antwort-Matrix (HTTP 400 mit `error`, außer Erfolg):

| Zustand | `error` |
|---|---|
| nicht existent / abgelaufen | `expired_token` |
| zu schnell gepollt | `slow_down` |
| `pending` | `authorization_pending` |
| `denied` | `access_denied` |
| `approved` | **200** Access-JWT + Refresh-Token (`issueTokens`), Code konsumiert |

**Store-API (`src/lib/oauth/store.ts`, neu)**
```ts
createDeviceCode(input: { clientId; scope }):
  Promise<{ deviceCode; userCode; expiresIn; interval }>
approveDeviceCode(userCode: string, uid: string): Promise<boolean>   // false wenn unbekannt/abgelaufen/nicht pending
denyDeviceCode(userCode: string): Promise<boolean>
pollDeviceCode(deviceCode: string):
  Promise<{ kind: "pending" | "slow_down" | "denied" | "expired" }
         | { kind: "approved"; uid; clientId; scope }>
// "approved" konsumiert den Code atomar (Transaktion), damit kein zweites Token entsteht.
```

**Discovery-Ergänzung**
```jsonc
{
  "device_authorization_endpoint": "<origin>/api/oauth/device_authorization",
  "grant_types_supported": [
    "authorization_code", "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code"
  ]
}
```

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `src/lib/oauth/config.ts` | `deviceCodes`-Collection, TTL, `interval`, `userCode`-Format | Klein |
| `src/lib/oauth/store.ts` | `createDeviceCode`/`approveDeviceCode`/`denyDeviceCode`/`pollDeviceCode` (+ `user_code`-Generator, sha256-Doc-ID, atomarer Approve-Konsum) | Mittel |
| `src/app/api/oauth/device_authorization/route.ts` | Neuer Endpoint (Client-Validierung, `rateLimit`, CORS, Origin) | Klein |
| `src/app/api/oauth/token/route.ts` | `device_code`-Grant-Zweig (Polling-Matrix → `issueTokens`) | Mittel |
| `src/app/api/oauth/device/confirm/route.ts` | Neuer Confirm-Endpoint (ID-Token → uid, approve/deny) | Klein |
| `src/app/device/page.tsx` + Form-Komponente | `user_code`-Eingabe (vorausgefüllt via Query), Firebase-Login, Consent mit `client_name`, approve/deny | Mittel |
| `src/app/.well-known/oauth-authorization-server/route.ts` | Endpoint + Grant-Type ergänzen | Klein |
| `src/app/api/oauth/register/route.ts` | `redirect_uris` optional bei Device-Grant (FA-10) | Klein |
| `firestore.rules` | `oauthDeviceCodes` sperren | Klein |
| `tests/` | Device-Flow-Tests (Happy Path, Polling-Zustände, Expiry, Replay, Rules) | Mittel |

### 3.2 Reihenfolge der Implementierung

1. **Config + Store** (`config.ts`, `store.ts`) inkl. `user_code`-Generator und
   atomarem Approve-Konsum — Fundament, isoliert testbar.
2. **firestore.rules**: `oauthDeviceCodes` sperren (+ Rules-Test) — zusammen mit
   dem Datenmodell (CLAUDE.md-Vorgabe).
3. **Device Authorization Endpoint** (`device_authorization/route.ts`).
4. **Token-Endpoint Device-Grant-Zweig** (`token/route.ts`).
5. **Device-Confirm-Endpoint** (`device/confirm/route.ts`).
6. **`/device`-Seite** (Eingabe + Login + Consent).
7. **Discovery + DCR-Lockerung** (Metadata, `register`).
8. **Tests** (MCP-Tool-Test-Setup als Vorbild) + manueller End-to-End-Durchlauf.
9. **(Optional/später) DPoP** als eigenes Issue.

## 4. Testplan

**Automatisiert (emulatorbasiert, `tests/`, vgl. `npm run test:mcp`)**
- `device_authorization` liefert wohlgeformte Response (Felder, TTL, `interval`).
- Token-Polling: `authorization_pending` vor Approve; `slow_down` bei zu schnellem
  Polling; `approved` → gültiges JWT (`sub`=uid) + Refresh-Token.
- Single-use: zweites Polling nach Erfolg liefert kein Token.
- Expiry: nach `deviceCodeTtlSec` → `expired_token`.
- Deny: `denyDeviceCode` → `access_denied`.
- `approveDeviceCode` mit unbekanntem/abgelaufenem `user_code` → `false`.
- Ausgestelltes Token wird von `authenticateMcp` als `user`/korrekte uid akzeptiert.

**Rules (`tests/firestore-rules.test.mjs`)**
- `oauthDeviceCodes` ist für authentifizierte Clients weder les- noch schreibbar.

**Manuell (End-to-End)**
- Device-Client (z.B. `curl`/CLI) startet Flow → `user_code`; Approve auf
  `/device` im zweiten Browser/Handy → Client erhält Token; Google-Login passiert
  nur auf `/device`.

## 5. Migration / Deployment

- **Keine Datenmigration** — additive Collection + Endpoints.
- Reihenfolge: App zuerst (Vercel-Auto-Deploy auf `main`), **danach**
  `firestore.rules` deployen (`npx -y firebase-tools@13 deploy --only
  firestore:rules`) — die neue Sperrregel ist additiv und für die bestehende App
  unkritisch.
- **Env:** keine neuen Variablen; `OAUTH_SIGNING_SECRET` + Admin SDK wie bisher.
- Discovery-Änderung ist abwärtskompatibel (zusätzliche Felder/Grants).

## 6. Referenzen

- [Konzeptdokument](01-konzept-oauth-device-grant.md)
- [Ist-Analyse](02-ist-analyse-oauth-device-grant.md)
- [Anforderungsanalyse](03-anforderungsanalyse-oauth-device-grant.md)
- RFC 8628 — OAuth 2.0 Device Authorization Grant
- RFC 8414 — Authorization Server Metadata; RFC 7591 — Dynamic Client Registration
- RFC 9449 — DPoP (für die optionale Härtung, FA-12)
- Bestehender AS: Epic #157, Issues #150–#155
