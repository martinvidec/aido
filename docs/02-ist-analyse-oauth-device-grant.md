# Ist-Analyse: OAuth 2.0 Device Authorization Grant (RFC 8628)

## 1. Aktueller Zustand

aido betreibt seit Epic #157 (Issues #150–#155) einen eigenen **OAuth 2.0
Authorization Server**. aido ist gleichzeitig Authorization Server und Resource
Server für seinen MCP-Endpoint (`/api/mcp/sse`). Implementiert sind heute:

- **Dynamic Client Registration** (RFC 7591) — `POST /api/oauth/register`.
- **Authorization Code Flow mit PKCE (S256)** — Consent-Seite `/oauth/authorize`
  + `POST /api/oauth/authorize/confirm`.
- **Token-Endpoint** — `POST /api/oauth/token` mit den Grants
  `authorization_code` und `refresh_token` (mit Rotation).
- **Discovery** — RFC 8414 (`/.well-known/oauth-authorization-server`) und
  RFC 9728 (`/.well-known/oauth-protected-resource`).

Der Nutzer-Login selbst läuft über **Firebase Auth (Google)**: die Consent-Seite
meldet den Nutzer per Firebase an und schickt dessen **ID-Token** an den
Confirm-Endpoint, der es mit dem Admin-SDK (`verifyIdToken`) zu einer `uid`
auflöst. Die `uid` (`sub` im Access-JWT) ist die alleinige Autorisierungsbasis.

Es gibt **keinen Device Authorization Grant**. Ein Client, der keinen Browser-
Redirect-Flow durchführen kann/will (CLI, headless, oder bewusst kein
Google-Login über einen MITM-Proxy), hat heute nur den Personal API Key als
Ausweg.

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `src/lib/oauth/config.ts` | `OAUTH`-Konstanten (Collections, Scope `aido.tools`, TTLs, Refresh-Prefix `aidor_`), `resourceUrl()`, `requestOrigin()` | Wird um Device-Code-Collection, TTL, `interval`, `user_code`-Format erweitert |
| `src/lib/oauth/store.ts` | Admin-SDK-Store: `createClient`/`getClient`, `createAuthCode`/`consumeAuthCode` (Transaktion, single-use), `createRefreshToken`/`consumeRefreshToken`/`revokeRefreshToken` (gehasht) | Vorbild + Erweiterung um Device-Code-Funktionen |
| `src/lib/oauth/tokens.ts` | `signAccessToken`/`verifyAccessToken` (HS256/jose, `OAUTH_SIGNING_SECRET`, `at+jwt`, `sub`=uid, `iss`/`aud` aus Origin) | **Unverändert** wiederverwendet |
| `src/lib/oauth/pkce.ts` | `verifyPkceS256` | Im Device-Flow nicht zwingend (kein Redirect); ggf. optional |
| `src/app/api/oauth/token/route.ts` | Token-Endpoint; `issueTokens()`-Helper (Access-JWT + Refresh); Grant-Switch; `rateLimit`; CORS | **Zentral**: neuer `device_code`-Grant-Zweig; `issueTokens` wird wiederverwendet |
| `src/app/api/oauth/authorize/confirm/route.ts` | Verifiziert Firebase-ID-Token → uid, validiert Client/redirect, mintet Auth-Code | Vorbild für den Device-Confirm-Endpoint (gleiche ID-Token-Verifikation) |
| `src/app/oauth/authorize/page.tsx` + `ConsentForm.tsx` | Serverseitig validierte Consent-Seite; Firebase-Google-Login; postet ID-Token an Confirm | Vorbild/Wiederverwendung für die `/device`-Seite (Login + Consent-UI, Tokens via `bg-bg`, `bg-accent`, …) |
| `src/app/.well-known/oauth-authorization-server/route.ts` | RFC-8414-Metadata: `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `grant_types_supported` | Erweitern: `device_authorization_endpoint`, Grant-Type ergänzen |
| `src/app/api/oauth/register/route.ts` | DCR; verlangt nicht-leere `redirect_uris` (http/https, kein Fragment) | Ggf. anpassen: `redirect_uris` für Device-Clients optional |
| `src/lib/mcp/auth.ts` | `authenticateMcp` akzeptiert Shared Secret, Personal API Key **und OAuth-Access-Token** (`resolveOAuthToken`) | **Unverändert** — akzeptiert das vom Device-Grant ausgestellte Token bereits |
| `firestore.rules` | `oauthClients`/`oauthCodes`/`oauthRefreshTokens` jeweils `allow read, write: if false` | Erweitern: `oauthDeviceCodes` ebenso sperren |
| `src/lib/apiKeys.ts` | `rateLimit(key, {max, windowMs})`, Hashing | `rateLimit` für den Device-Auth-Endpoint wiederverwenden |

## 3. Bestehende Abhängigkeiten

- **Intern:** Token-/Confirm-/Authorize-Routen → `src/lib/oauth/*`; OAuth-Store →
  Admin SDK (`getAdminDb`); Confirm/Consent → Firebase Auth (`getAdminAuth` /
  Client-SDK Google-Login); MCP-Auth → `verifyAccessToken`.
- **Extern:** `jose` (JWT-Signatur, ESM), `firebase-admin` (Firestore-Store +
  `verifyIdToken`), `mcp-handler` (`getPublicOrigin` für Discovery/Origin),
  Firestore als persistenter Store für alle AS-Artefakte.
- **Konfiguration:** `OAUTH_SIGNING_SECRET` (Pflicht für Token-Signatur),
  `FIREBASE_SERVICE_ACCOUNT_KEY` (Admin SDK; ohne ihn 503).

## 4. Bekannte Einschränkungen

- **Serverless-Persistenz:** Anders als die MCP-Sessions (in-memory, nicht
  durabel) liegt der OAuth-State bereits in Firestore — der Device-Code-Store muss
  ebenfalls Firestore nutzen, damit Polling über mehrere Instanzen hinweg
  funktioniert.
- **DCR erzwingt `redirect_uris`:** der Register-Endpoint lehnt eine leere Liste
  ab — für reine Device-Clients ist das anzupassen oder zu umgehen.
- **Symmetrische Token-Signatur (HS256):** unverändert ausreichend, da aido AS und
  RS zugleich ist. Für DPoP wäre kein Wechsel nötig (DPoP bindet über `cnf`/`jkt`,
  nicht über den AT-Signaturalgorithmus).
- **Rate-Limiting** ist in-memory pro Instanz (`rateLimit`) — gegen Polling-Abuse
  ausreichend, aber nicht instanzübergreifend exakt. Das `interval`/`slow_down`
  des Device-Flows ist die primäre Polling-Drossel.
- **Java/Tooling:** Rules-Tests laufen nur über `firebase-tools@13` (Java 11),
  siehe CLAUDE.md.

## 5. Risiken bei Änderung

- **Token-Endpoint** ist sicherheitskritisch und wird von Claude/MCP-Clients
  produktiv genutzt. Der neue Grant-Zweig darf die bestehenden `authorization_code`/
  `refresh_token`-Pfade nicht verändern (nur additiv); `issueTokens` bleibt
  unangetastet.
- **Polling-Missbrauch / DoS:** ohne korrektes `interval`+`slow_down`+`expires_in`
  kann ein Client den Endpoint fluten. `expired_token` + single-use-Konsum des
  `device_code` müssen sauber greifen.
- **`user_code`-Rate/Entropie:** ein zu kurzer/schwacher `user_code` lädt zu
  Brute-Force auf der `/device`-Seite ein → Eingabe-Rate-Limit + kurze TTL nötig.
- **firestore.rules:** wird die neue Collection nicht gesperrt, wäre der
  Device-Code-State clientseitig lesbar. Regel **und** Rules-Test gemeinsam
  ergänzen (CLAUDE.md-Vorgabe).
- **DCR-Lockerung:** `redirect_uris` optional zu machen, darf den
  Authorization-Code-Flow (der sie zwingend braucht) nicht aufweichen.
- **Discovery-Kompatibilität:** zusätzliche Felder/Grants in der AS-Metadata sind
  additiv und für bestehende Clients unkritisch.
