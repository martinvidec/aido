# Anforderungsanalyse: OAuth für den MCP-Connector

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | RS-Discovery | **Muss** | `GET /.well-known/oauth-protected-resource` liefert RS-Metadaten (verweist auf den aido-AS). Per `mcp-handler.protectedResourceHandler`. |
| FA-02 | `WWW-Authenticate` | **Muss** | Unauthorisierte MCP-Requests antworten 401 mit `WWW-Authenticate: Bearer resource_metadata=…`, damit Claude die Discovery startet. |
| FA-03 | AS-Metadaten | **Muss** | `GET /.well-known/oauth-authorization-server` liefert AS-Metadaten (authorization/token/registration_endpoint, `code_challenge_methods_supported:[S256]`, `grant_types`, `scopes`). |
| FA-04 | Dynamic Client Registration | **Muss** | `POST /api/oauth/register` (RFC 7591): nimmt `redirect_uris`, gibt `client_id` (+ ggf. `client_secret`) zurück; speichert in `oauthClients`. Rate-limitiert. |
| FA-05 | Authorization-Endpoint | **Muss** | `GET /api/oauth/authorize`: validiert `client_id`/`redirect_uri`/`response_type=code`/PKCE-`code_challenge`(S256)/`state`; rendert die **Consent-Seite**. |
| FA-06 | Consent + Login | **Muss** | Consent-Seite nutzt die Firebase-Google-Anmeldung; zeigt „Angemeldet als <Name>"; „Erlauben" → ID-Token an den Server. |
| FA-07 | Auth-Code ausstellen | **Muss** | Server verifiziert das ID-Token (`verifyIdToken`→uid), erstellt einen einmaligen, kurzlebigen Auth-Code (bindet uid, client_id, redirect_uri, code_challenge) in `oauthCodes`, 302 zurück an `redirect_uri?code=…&state=…`. |
| FA-08 | Token-Endpoint (code) | **Muss** | `POST /api/oauth/token` `grant_type=authorization_code`: prüft Code (einmalig, nicht abgelaufen), PKCE-`code_verifier` gegen `code_challenge`, `redirect_uri`/`client_id`; gibt **Access-Token (JWT, `sub`=uid)** + **Refresh-Token** + `expires_in` zurück. |
| FA-09 | Token-Endpoint (refresh) | **Soll** | `grant_type=refresh_token`: prüft Refresh-Token in `oauthRefreshTokens` (nicht widerrufen/abgelaufen) → neues Access-Token (+ rotiertes Refresh-Token). |
| FA-10 | MCP akzeptiert OAuth-Token | **Muss** | `authenticateMcp` erkennt ein OAuth-JWT (Signatur+`aud`+`exp`+`scope`) und liefert `{kind:'user', uid}`. API-Key/Shared-Token-Pfade bleiben. |
| FA-11 | Token-Revocation | **Soll** | `POST /api/oauth/revoke` (oder UI in Settings): Refresh-Token widerrufen; aktive Access-Tokens laufen kurz aus. |
| FA-12 | Connector-fähige UI-Hilfe | **Kann** | In Settings die Connector-URL anzeigen + „verbundene Connectors/Tokens verwalten". |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | PKCE zwingend | Sicherheit | Nur `code_challenge_method=S256`; ohne gültigen `code_verifier` kein Token. |
| NFA-02 | Strikte Redirect-/Client-Prüfung | Sicherheit | `redirect_uri` exakt gegen die beim Client registrierten matchen; `state` unverändert durchreichen. |
| NFA-03 | Token-Härtung | Sicherheit | Access-Token kurzlebig (z. B. 1 h), `aud`/`iss`/`exp` geprüft; Auth-Codes einmalig + ≤60 s; Refresh-Tokens nur als Hash gespeichert, widerrufbar, rotiert. |
| NFA-04 | Speicher admin-only | Sicherheit | `oauthClients`/`oauthCodes`/`oauthRefreshTokens` in `firestore.rules` komplett gesperrt (nur Admin-SDK). |
| NFA-05 | Mandantentrennung unverändert | Sicherheit | Die uid aus dem Token ist die alleinige Autorisierung; `requireMember`/Tools bleiben. |
| NFA-06 | Korrekte Discovery hinter Proxy | Robustheit | Metadaten-URLs aus `getPublicOrigin`/`X-Forwarded-*` (Vercel) ableiten, nicht aus `req.url`. |
| NFA-07 | Rate-Limiting | Stabilität | `/register` und `/token` pro IP/Client begrenzt (analog `apiKeys.rateLimit`). |
| NFA-08 | Keine Regression | Zuverlässigkeit | API-Key-/Shared-Token-Pfad und die 10 Tools funktionieren unverändert weiter. |

## 3. Akzeptanzkriterien

- [ ] „Add custom connector" auf claude.ai mit der aido-URL führt durch Login/Consent und endet in einem **verbundenen** Connector.
- [ ] Ein Tool-Call (`list-spaces`) über den Web-Connector liefert die **echten** Spaces des angemeldeten Nutzers.
- [ ] Unauthorisierter MCP-Request → 401 mit `WWW-Authenticate` + funktionierender Discovery-Kette (`/.well-known/*`).
- [ ] DCR (`/register`) liefert eine `client_id`; ein Flow ohne gültiges PKCE/`redirect_uri` wird abgewiesen.
- [ ] Auth-Code ist einmalig und kurzlebig; ein zweiter Token-Tausch desselben Codes schlägt fehl.
- [ ] Access-Token mit falscher Signatur/`aud` oder abgelaufen → MCP antwortet 401.
- [ ] Der bestehende **API-Key**-Pfad (Claude Code) verbindet weiterhin.
- [ ] Refresh-Token erneuert ein Access-Token; ein widerrufenes Refresh-Token wird abgelehnt.
- [ ] Die OAuth-Collections sind per Rules für Clients **nicht** lesbar/schreibbar (Rules-Test).

## 4. Abhängigkeiten zu anderen Anforderungen

- Baut auf der bestehenden MCP-Auth (#117) und dem mcp-handler-Transport (#140) auf.
- Nutzt Firebase Auth (verifyIdToken) und das Admin-SDK (wie #21 API-Keys).
- FA-10 (MCP akzeptiert Token) hängt an FA-08 (Token-Issuing); FA-05/06/07 bilden zusammen den Authorize-Flow.

## 5. Priorisierung

1. **Discovery + RS-Anschluss (Muss):** FA-01, FA-02, FA-03.
2. **DCR (Muss):** FA-04.
3. **Authorize-Flow (Muss):** FA-05, FA-06, FA-07.
4. **Token (Muss/Soll):** FA-08, dann FA-09.
5. **MCP-Integration (Muss):** FA-10 — schaltet den Connector scharf.
6. **Lifecycle/Komfort (Soll/Kann):** FA-11, FA-12.
