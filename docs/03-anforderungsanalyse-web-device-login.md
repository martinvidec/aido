# Anforderungsanalyse: Web-Login per Device-Flow (Zweitgerät-Anmeldung)

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Device-Login-Store | Muss | Admin-SDK-Collection `deviceLoginCodes`: `userCode`, `status` (`pending`/`approved`/`denied`), `uid`, `interval`, `lastPolledAt`, `expiresAt`; Doc-ID = `sha256(device_code)`. Lookup per `device_code` **und** per `user_code`; atomarer Single-use-Konsum bei Approve. |
| FA-02 | Start-Endpoint | Muss | `POST /api/auth/device/start` erzeugt `device_code`+`user_code` (pending) und liefert `verification_uri`, `verification_uri_complete`, `expires_in`, `interval`. |
| FA-03 | Confirm-Endpoint (Zweitgerät) | Muss | `POST /api/auth/device/confirm`: `verifyIdToken(idToken) → uid`, `user_code` nachschlagen, Status `approved`+uid bzw. `denied`. |
| FA-04 | Poll-Endpoint → Custom Token | Muss | `POST /api/auth/device/poll` mit `device_code`. Antworten: `authorization_pending`, `slow_down`, `expired_token`, `access_denied`; bei Approve `getAdminAuth().createCustomToken(uid)` → `{ firebaseCustomToken }`, Code single-use konsumiert. |
| FA-05 | Consent-Seite `/device` | Muss | Auf dem Handy: `user_code`-Eingabe (vorausgefüllt via `verification_uri_complete`), Firebase-Google-Login, Approve/Deny → Confirm-Endpoint. |
| FA-06 | Login-UI am Arbeitsrechner | Muss | Panel „Anmelden über Zweitgerät" in `src/app/login`: Start aufrufen, `user_code` + URL + **QR** anzeigen, pollen, bei Erfolg `signInWithCustomToken(auth, token)` → Redirect `/todos`. |
| FA-07 | Polling-Drossel & Expiry | Muss | `slow_down` bei zu schnellem Polling (`lastPolledAt`); abgelaufener Code → `expired_token`; Erfolg single-use. |
| FA-08 | firestore.rules | Muss | `deviceLoginCodes` vollständig sperren (`allow read, write: if false`) + Rules-Test. |
| FA-09 | QR-Code | Soll | `verification_uri_complete` als scanbarer QR-Code in der Login-UI. |
| FA-10 | Session-Folgeprozesse | Soll | Nach `signInWithCustomToken` laufen User-/Profil-Anlage + Legacy-Migration wie nach Google-Login (über `AuthProvider`/`onAuthStateChanged`) — verifizieren. |
| FA-11 | Härtung & Revoke (optional) | Kann | Kurze TTL, Eingabe-Rate-Limit auf `user_code`, Tooling/Doku zum Session-Revoke (`revokeRefreshTokens(uid)`). |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Google-Credential bleibt off-proxy | Sicherheit | Login + Consent laufen ausschließlich auf `/device` (Zweitgerät); der Arbeitsrechner führt **keinen** Google-Login durch. |
| NFA-02 | Echte Firebase-Session | Funktion | Ergebnis ist eine reguläre Firebase-Session (ID- + Refresh-Token im Browser), identisch zum Google-Login-Ergebnis. |
| NFA-03 | Custom-Token-Exposition minimieren | Sicherheit | Kurze `device_code`-TTL, Single-use-Konsum, sofortiger Exchange; Session über `revokeRefreshTokens` widerrufbar. (DPoP nicht anwendbar.) |
| NFA-04 | Brute-Force-Schutz `user_code` | Sicherheit | Ausreichende Entropie (≥ ~8 Zeichen, ambig-frei), kurze TTL, Eingabe-Rate-Limit. |
| NFA-05 | DoS-/Abuse-Schutz | Stabilität | `rateLimit` auf Start/Confirm/Poll; Polling über `interval`/`slow_down`/`expires_in` begrenzt. |
| NFA-06 | Persistenz serverless-tauglich | Zuverlässigkeit | Device-Login-State in Firestore (instanzübergreifendes Polling). |
| NFA-07 | Testbarkeit | Wartbarkeit | Endpoints als Web `Request`/`Response`; Emulator-Tests analog `test:mcp`/`test:rules`. |
| NFA-08 | Bestehender Login unverändert | Kompatibilität | Der normale Google-Login bleibt funktional unverändert; Device-Login ist additiv. |

## 3. Akzeptanzkriterien

- [ ] `start` liefert `device_code` + kurzes `user_code` + `verification_uri(_complete)`/`expires_in`/`interval`.
- [ ] Vor Bestätigung liefert `poll` `authorization_pending`; zu schnelles Polling `slow_down`.
- [ ] Nach Login + Approve auf `/device` (Zweitgerät) liefert `poll` ein `firebaseCustomToken`.
- [ ] `signInWithCustomToken` etabliert eine Firebase-Session; der Nutzer landet eingeloggt auf `/todos`.
- [ ] User-Doc/`publicProfile`/Migration laufen nach Custom-Token-Login wie nach Google-Login.
- [ ] Ein bereits eingelöster `device_code` liefert kein zweites Token; abgelaufen → `expired_token`; abgelehnt → `access_denied`.
- [ ] `user_code` ist menschenlesbar/ambig-frei und via `verification_uri_complete` vorausfüllbar; QR ist scanbar.
- [ ] `deviceLoginCodes` ist clientseitig weder les- noch schreibbar (Rules-Test grün).
- [ ] Während des gesamten Flows findet **kein** Google-Login über den Arbeitsrechner-(Proxy-)Kanal statt.

## 4. Abhängigkeiten zu anderen Anforderungen

- Nutzt Admin SDK + Firebase-Client (vorhanden) und das Consent-/`verifyIdToken`-
  Muster aus dem OAuth-Confirm (#153).
- **Verwandt mit Epic #175** (OAuth-Device-Grant für MCP): gleiches Device-Flow-
  Muster, anderes Abschlussartefakt. Bewusst **entkoppelt** (eigener Store), damit
  keine Blockade durch #166; spätere Store-Vereinheitlichung optional.
- FA-09 (QR) kann eine kleine zusätzliche Dependency erfordern.

## 5. Priorisierung

1. **Muss (Kern):** FA-01, FA-02, FA-03, FA-04, FA-07 — lauffähiger Flow bis Custom Token.
2. **Muss (UI/Sicherheit):** FA-05, FA-06, FA-08 — Consent-Seite, Login-UI, Rules.
3. **Soll:** FA-09 (QR), FA-10 (Folgeprozesse verifizieren).
4. **Kann:** FA-11 (Härtung/Revoke-Tooling).
