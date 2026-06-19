# Konzept: Web-Login per Device-Flow (Zweitgerät-Anmeldung)

## 1. Zusammenfassung

aido soll eine **Anmeldung der Web-UI über ein zweites, vertrauenswürdiges Gerät**
anbieten — angelehnt an den OAuth 2.0 Device Authorization Grant (RFC 8628). Der
Arbeitsrechner zeigt einen kurzen Code (+ QR), die eigentliche Anmeldung (Google/
Firebase) und Bestätigung erfolgen auf dem Handy (Mobilfunk). Der Arbeitsrechner
pollt und erhält am Ende ein **Firebase Custom Token**, das er per
`signInWithCustomToken` zu einer **vollwertigen Web-Session** macht.

> Verwandt mit, aber getrennt von Epic #175 (OAuth-Device-Grant für MCP): dort ist
> das Abschlussartefakt ein OAuth-Access-JWT für den MCP-Resource-Server. Hier ist
> es ein **Firebase Custom Token** für die **Web-UI-Session**. Beide nutzen dasselbe
> Device-Flow-Muster und könnten den Code-Store später teilen.

## 2. Problemstellung

Aido wird teils aus Umgebungen mit TLS-aufbrechendem Firmenproxy genutzt. Dass
der Proxy die aido-Daten mitliest, ist akzeptabel — die **Google-Anmeldung**
(Firebase Auth) darf aber **nicht** über diesen Kanal laufen, weil sonst das
hochwertige Google-Credential für den Proxy sichtbar würde.

Die Web-UI authentifiziert sich heute ausschließlich über den **clientseitigen
Firebase-Google-Login** im Browser. Am Arbeitsrechner würde dieser Login direkt
durch den Proxy gehen. Der in Epic #175 entworfene Device-Grant löst das nur für
**MCP/programmatischen** Zugriff — sein Token ist **keine Firebase-Session** und
loggt die Web-UI nicht ein.

Es fehlt ein Anmeldeweg, der eine **Firebase-Web-Session** etabliert, ohne dass
das Google-Credential den unsicheren Kanal berührt.

## 3. Zielsetzung

- Der Nutzer kann sich in der aido-Web-UI am Arbeitsrechner anmelden, **ohne dass
  der Google-Login den Proxy passiert** (Login + Consent nur auf dem Zweitgerät).
- Ergebnis ist eine **echte Firebase-Web-Session** (wie nach normalem Google-Login)
  — der Nutzer landet eingeloggt auf `/todos`.
- Device-Flow-UX nach RFC-8628-Muster (kurzes `user_code`, QR, Polling mit
  `authorization_pending`/`slow_down`/`expired_token`).
- **Maximale Wiederverwendung**: Admin-SDK + `verifyIdToken` (wie OAuth-Confirm),
  Consent-UI-Muster (`ConsentForm`), `firestore.rules`-Disziplin, vorhandener
  Firebase-Client.
- Resultierende Session ist **aido-scoped und widerrufbar**
  (`revokeRefreshTokens`).

Messbar erreicht, wenn: der Arbeitsrechner nach Approve auf dem Handy in der
Web-UI eingeloggt ist und zu keinem Zeitpunkt ein Google-Login über den
Proxy-Kanal stattfand.

## 4. Lösungsidee

Ein Device-Flow, dessen Abschlussartefakt ein Firebase Custom Token ist:

1. **Start** (`POST /api/auth/device/start`): die unangemeldete Web-UI am
   Arbeitsrechner fordert einen Code an. Server erzeugt `device_code` (opak) +
   `user_code` (kurz), legt sie mit Status `pending` im Admin-SDK-Store ab und
   liefert `verification_uri`, `verification_uri_complete`, `expires_in`,
   `interval`.
2. **Anzeige**: die Web-UI zeigt `user_code` + URL und einen **QR-Code**
   (`verification_uri_complete`) zum Scannen mit dem Handy.
3. **Consent auf dem Zweitgerät** (`/device`): der Nutzer öffnet die Seite am
   Handy (Mobilfunk), meldet sich mit dem bestehenden Firebase-Google-Login an,
   gibt/scannt den `user_code` und bestätigt. „Erlauben" postet das Firebase-ID-
   Token an `POST /api/auth/device/confirm`, das es zu einer `uid` verifiziert und
   den Datensatz auf `approved` + `uid` setzt.
4. **Polling** (`POST /api/auth/device/poll`): die Web-UI pollt mit dem
   `device_code`. Vor Bestätigung `authorization_pending`/`slow_down`; nach
   Approve mintet der Server `getAdminAuth().createCustomToken(uid)` und liefert
   `{ firebaseCustomToken }` (Code wird single-use konsumiert).
5. **Session**: die Web-UI ruft `signInWithCustomToken(auth, token)` → Firebase-
   Web-Session steht → Redirect nach `/todos`.

Der Google-Login passiert ausschließlich auf dem Handy (Mobilfunk); der
Arbeitsrechner sieht nur das Custom Token bzw. die daraus entstehende Session.

## 5. Betroffene Komponenten

| Bereich | Datei(en) | Art der Betroffenheit |
|---|---|---|
| Device-Login-Store | `src/lib/auth/deviceLogin.ts` (neu) | Neu: Code-Erzeugung, approve/deny, poll (atomarer Single-use-Konsum), `user_code`-Format, TTL/Interval. Collection `deviceLoginCodes` |
| Start-Endpoint | `src/app/api/auth/device/start/route.ts` (neu) | Neu: Code anfordern (+ `rateLimit`) |
| Confirm-Endpoint | `src/app/api/auth/device/confirm/route.ts` (neu) | Neu: ID-Token → uid, approve/deny |
| Poll-Endpoint | `src/app/api/auth/device/poll/route.ts` (neu) | Neu: Polling-Matrix → `createCustomToken` bei Approve |
| Consent-Seite (Handy) | `src/app/device/page.tsx` + Form (neu) | Neu: `user_code`-Eingabe, Google-Login, Approve/Deny (Muster: `ConsentForm.tsx`) |
| Login-UI (Arbeitsrechner) | `src/app/login/*` | Erweitern: Panel „Anmelden über Zweitgerät" (Start + Code/QR + Polling + `signInWithCustomToken`) |
| Firebase-Client | `src/lib/firebase/firebase.ts` / `useAuth` | Wiederverwendet: `signInWithCustomToken` |
| Admin SDK | `src/lib/firebase/admin.ts` | Wiederverwendet: `getAdminAuth().verifyIdToken` + `createCustomToken` |
| Firestore-Rules | `firestore.rules` | Neu: `deviceLoginCodes` sperren |
| Tests | `tests/` | Neu: Device-Login-Flow (Happy Path, Polling, Expiry, Deny, Single-use, Rules) |

## 6. Abgrenzung

Nicht Teil dieser Anforderung:

- **MCP-/OAuth-Token.** Das Abschlussartefakt ist eine Firebase-Web-Session, kein
  OAuth-Access-Token für den MCP-Resource-Server (das ist Epic #175). Beide Flows
  bleiben getrennt; eine spätere Vereinheitlichung des Code-Stores ist optional.
- **DPoP / sender-constrained Tokens.** Firebase-Sessions lassen sich nicht per
  DPoP an einen Client-Schlüssel binden → für diesen Flow **nicht anwendbar**
  (siehe Offene Fragen / Risiko). Der Schutz beschränkt sich darauf, das
  Google-Credential vom Proxy fernzuhalten; die resultierende Session bleibt ein
  Bearer-Artefakt (akzeptiertes Residual, widerrufbar).
- **Ablösung des normalen Google-Logins.** Der Device-Login kommt additiv als
  zweiter Anmeldeweg hinzu.

## 7. Offene Fragen

1. **Custom-Token-Residual.** Der Proxy sieht das Custom Token in der Poll-Antwort
   und könnte es innerhalb seiner ~1 h Gültigkeit selbst gegen eine Session
   tauschen (Google-Credential bleibt sicher; Schaden = eine aido-Web-Session,
   widerrufbar). **Entscheidung getroffen:** akzeptieren + optionales
   Härtungs-Issue (kurze TTL, Single-use, sofortiger Exchange, Session-Revoke-/
   Rate-Limit-Tooling).
2. **`verification_uri`.** Vorschlag: top-level `/device` (gut tippbar),
   `verification_uri_complete` = `/device?user_code=…` (für QR). → ok?
3. **`user_code`-Format.** Vorschlag: 8 Zeichen, gruppiert `WDJB-MJHT`, Alphabet
   ohne mehrdeutige Zeichen. → ok?
4. **QR-Anzeige.** Eigene kleine QR-Erzeugung (z.B. `qrcode`-Lib) oder zunächst nur
   URL + Code anzeigen? (Empfohlen: QR, deutlich bessere UX.)
5. **Store-Sharing mit #175.** Eigener `deviceLoginCodes`-Store (entkoppelt, nicht
   durch #166 blockiert) — spätere Vereinheitlichung mit dem OAuth-Device-Store
   optional. → so ok?
