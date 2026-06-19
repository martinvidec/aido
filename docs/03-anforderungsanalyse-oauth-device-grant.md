# Anforderungsanalyse: OAuth 2.0 Device Authorization Grant (RFC 8628)

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Device Authorization Endpoint | Muss | `POST /api/oauth/device_authorization` nimmt `client_id` (+ optional `scope`) und liefert `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in`, `interval` (RFC 8628 §3.1/§3.2). |
| FA-02 | Device-Code-Store | Muss | Neue Admin-SDK-Collection `oauthDeviceCodes`: persistiert `user_code`, `client_id`, `scope`, `status` (`pending`/`approved`/`denied`), `uid`, `interval`, `lastPolledAt`, `expiresAt`. Lookup per `device_code` **und** per `user_code`. |
| FA-03 | Verifikationsseite `/device` | Muss | Nutzer öffnet `/device` (auf Trusted Device), meldet sich per Firebase-Google-Login an, gibt den `user_code` ein, sieht den Client-Namen und bestätigt/lehnt ab. `verification_uri_complete` füllt den Code vor. |
| FA-04 | Device-Confirm-Endpoint | Muss | `POST /api/oauth/device/confirm`: verifiziert das Firebase-ID-Token → `uid`, schlägt den `user_code` nach, setzt den Datensatz auf `approved` + `uid` (bzw. `denied`). |
| FA-05 | Token-Endpoint: Device-Grant | Muss | `grant_type=urn:ietf:params:oauth:grant-type:device_code` mit `device_code`+`client_id`. Antworten: `authorization_pending`, `slow_down`, `access_denied`, `expired_token` (RFC 8628 §3.5) und bei Erfolg Access-JWT + Refresh-Token via vorhandenem `issueTokens`. |
| FA-06 | Single-use & Expiry | Muss | `device_code` wird bei erfolgreicher Ausgabe konsumiert (kein zweites Token); abgelaufene Codes → `expired_token`. |
| FA-07 | Polling-Drossel | Muss | Pollt der Client schneller als `interval`, antwortet der Endpoint `slow_down`; `lastPolledAt` wird geführt. |
| FA-08 | Discovery-Erweiterung | Muss | `/.well-known/oauth-authorization-server` weist `device_authorization_endpoint` aus und ergänzt `urn:ietf:params:oauth:grant-type:device_code` in `grant_types_supported`. |
| FA-09 | firestore.rules | Muss | `oauthDeviceCodes` wird vollständig gesperrt (`allow read, write: if false`), analog der übrigen OAuth-Collections. |
| FA-10 | DCR für Device-Clients | Soll | `/api/oauth/register` akzeptiert Clients ohne `redirect_uris`, sofern `grant_types` den Device-Code-Grant enthält (oder ein dedizierter First-Party-Client). |
| FA-11 | Client-Identität im Consent | Soll | Die `/device`-Seite zeigt den registrierten `client_name`, damit der Nutzer weiß, welches Gerät er freigibt. |
| FA-12 | DPoP-Bindung | Kann | Optionaler `dpop_jkt`/`cnf`-Pfad: Device-Client schickt einen DPoP-Proof, das ausgestellte Token wird sender-constrained. Eigenes Folge-Issue. |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Google-Credential bleibt off-proxy | Sicherheit | Login + Consent laufen ausschließlich auf der `/device`-Seite (Zweitgerät). Der pollende Client führt **keinen** Google-Login durch. |
| NFA-02 | Bestehende Grants unverändert | Kompatibilität | `authorization_code`/`refresh_token`-Pfade und `issueTokens` bleiben funktional unverändert (nur additive Ergänzung). |
| NFA-03 | Brute-Force-Schutz `user_code` | Sicherheit | Ausreichende Entropie (≥ ~8 Zeichen, ambig-freies Alphabet), kurze TTL, Eingabe-Rate-Limit auf der `/device`-Seite. |
| NFA-04 | DoS-/Abuse-Schutz | Sicherheit/Stabilität | `rateLimit` auf `device_authorization`; Polling über `interval`/`slow_down`/`expires_in` begrenzt. |
| NFA-05 | Token-Profil identisch | Sicherheit | Ausgestellte Tokens sind kurzlebig (1 h), refresh-rotiert (30 d), aido-scoped und über `revokeRefreshToken` widerrufbar — wie beim Code-Flow. |
| NFA-06 | Persistenz serverless-tauglich | Zuverlässigkeit | Device-Code-State in Firestore, damit Polling über mehrere Instanzen funktioniert. |
| NFA-07 | Testbarkeit | Wartbarkeit | Endpoints als Web `Request`/`Response` (kein `next/server`-Zwang) für isolierte Tests, analog der bestehenden OAuth-Routen. |
| NFA-08 | Standardkonformität | Interoperabilität | Strikte Einhaltung von RFC 8628 (Feldnamen, Fehlercodes, HTTP-Status). |

## 3. Akzeptanzkriterien

- [ ] Ein Device-Client erhält über `device_authorization` ein `device_code` +
      kurzes `user_code` + korrekte `verification_uri(_complete)`/`expires_in`/`interval`.
- [ ] Vor Bestätigung liefert der Token-Endpoint `authorization_pending`; zu
      schnelles Polling liefert `slow_down`.
- [ ] Nach Login + Consent auf `/device` (Zweitgerät) liefert der Token-Endpoint
      ein gültiges Access-JWT (`sub`=uid) **und** einen Refresh-Token.
- [ ] Das ausgestellte Token wird vom MCP-Endpoint (`authenticateMcp`) als
      `principal.kind === "user"` mit korrekter `uid` akzeptiert.
- [ ] Ein bereits eingelöstes `device_code` liefert beim erneuten Polling kein
      zweites Token; ein abgelaufenes liefert `expired_token`; ein abgelehntes
      liefert `access_denied`.
- [ ] Der `user_code` ist menschenlesbar, ambig-frei und vorausfüllbar via
      `verification_uri_complete`.
- [ ] `oauthDeviceCodes` ist clientseitig weder les- noch schreibbar (Rules-Test
      grün).
- [ ] Die AS-Metadata weist Endpoint + Grant-Type aus.
- [ ] Während des gesamten Flows passiert der Google-Login nie über den Client-
      (Proxy-)Kanal — verifiziert anhand des Ablaufs (Login nur auf `/device`).

## 4. Abhängigkeiten zu anderen Anforderungen

- Baut auf dem bestehenden OAuth-AS (Epic #157, Issues #150–#155) auf;
  insbesondere Token-Endpoint (#154), Confirm/Consent (#153), DCR (#152),
  Discovery (#151), OAuth-Token-Akzeptanz im MCP (#155).
- FA-10 (DCR-Lockerung) ist Voraussetzung dafür, dass ein reiner Device-Client
  überhaupt eine `client_id` bekommt — alternativ ein fest hinterlegter
  First-Party-Client.
- FA-12 (DPoP) ist optional und unabhängig; setzt aber auf dem hier gebauten
  Token-Ausgabepfad auf.

## 5. Priorisierung

1. **Muss (Kern-Flow):** FA-01, FA-02, FA-05, FA-06, FA-07 — der lauffähige
   Device-Grant.
2. **Muss (Sicherheit/Sichtbarkeit):** FA-09, FA-08, FA-03, FA-04 — Consent-
   Oberfläche + Discovery + Rules.
3. **Soll:** FA-10, FA-11 — saubere Client-Registrierung und Consent-Transparenz.
4. **Kann/Später:** FA-12 (DPoP) — zusätzliche Härtung gegen aktiven MITM.
