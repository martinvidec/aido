# Spezifikation: OAuth für den MCP-Connector (Firebase-basiert)

## 1. Übersicht

aido wird zum **OAuth-2.1-Authorization-Server für den eigenen MCP-Resource-Server**. Nutzer-Login kommt aus der bestehenden Firebase-Google-Anmeldung; aido baut die AS-Endpoints (Discovery, DCR, authorize, token), eine Consent-Seite und die Token-Validierung im MCP-Pfad. Access-Tokens sind kurzlebige, von aido signierte JWTs (`sub`=uid); Refresh-Tokens sind opake, in Firestore widerrufbare Werte. Der bestehende API-Key-Pfad bleibt.

## 2. Technisches Design

### 2.1 Architektur (Flow)

```
Claude (Web)                aido (Next.js)                         Firebase
  │  1. GET MCP → 401 WWW-Authenticate (resource_metadata)
  │  2. GET /.well-known/oauth-protected-resource  → AS-URL (aido)
  │  3. GET /.well-known/oauth-authorization-server → endpoints
  │  4. POST /api/oauth/register (DCR) → client_id           [oauthClients]
  │  5. GET /api/oauth/authorize?…PKCE,state → Consent-Page
  │        └─ Nutzer: Google-Login (Firebase) ──────────────▶ ID-Token
  │        └─ "Erlauben" → POST ID-Token + req → verifyIdToken→uid
  │                                   → Auth-Code (uid,…)     [oauthCodes]
  │  ◀─ 302 redirect_uri?code&state
  │  6. POST /api/oauth/token (code + code_verifier)
  │        → JWT access_token(sub=uid) + refresh_token        [oauthRefreshTokens]
  │  7. MCP-Calls mit Bearer <jwt> → authenticateMcp verifiziert → uid
  ▼                                   → runWithPrincipal({user,uid}) → Tools
```

### 2.2 Datenmodell (neue Firestore-Collections, admin-only)

- `oauthClients/{client_id}`: `redirect_uris[]`, `client_name?`, `token_endpoint_auth_method`, `createdAt`. (DCR)
- `oauthCodes/{code}`: `uid`, `client_id`, `redirect_uri`, `code_challenge`, `scope`, `expiresAt` (≤60 s), `used:false`. (einmalig)
- `oauthRefreshTokens/{tokenHash}`: `uid`, `client_id`, `scope`, `createdAt`, `expiresAt`, `revoked:false`. (Hash, rotiert)

`firestore.rules`: alle drei `allow read, write: if false;` (nur Admin-SDK) — analog `userApiKeys`. Tests in `tests/firestore-rules.test.mjs` ergänzen.

### 2.3 Schnittstellen

| Endpoint | Methode | Zweck |
|---|---|---|
| `/.well-known/oauth-protected-resource` | GET | RS-Metadaten (mcp-handler `protectedResourceHandler`) |
| `/.well-known/oauth-authorization-server` | GET | AS-Metadaten (authorize/token/register, S256, scopes) |
| `/api/oauth/register` | POST | DCR (RFC 7591) → `client_id` |
| `/api/oauth/authorize` | GET | Validierung + rendert Consent-Page |
| `/api/oauth/authorize/confirm` | POST | ID-Token→uid, Auth-Code ausstellen, Redirect-Daten |
| `/api/oauth/token` | POST | `authorization_code` & `refresh_token` grants |
| `/api/oauth/revoke` | POST | Refresh-Token widerrufen *(Soll)* |

**Token (JWT, HS256):** `iss`=Basis-URL, `aud`=RS-URL, `sub`=uid, `scope`, `client_id`, `exp` (~1 h), `iat`. Signatur mit `OAUTH_SIGNING_SECRET` via `jose` (bereits vorhanden, ESM-import-sicher).

**`authenticateMcp` (erweitert):** Reihenfolge — Shared-Token → API-Key (`aido_…`) → sonst **OAuth-JWT**: `jose.jwtVerify(token, secret, {aud, iss})`; bei Erfolg `{kind:'user', uid: payload.sub}`.

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `src/lib/oauth/*` (neu) | Token-Sign/Verify, Code/Refresh-Helfer, Client-Store (Admin) | **Groß** |
| `/.well-known/*` (neu) | RS- + AS-Metadaten-Routen | Klein |
| `/api/oauth/register` (neu) | DCR + Rate-Limit | Mittel |
| `/api/oauth/authorize` (+ Consent-Page) | Validierung + Consent-UI (Firebase-Login) | **Groß** |
| `/api/oauth/authorize/confirm` (neu) | verifyIdToken→uid, Code ausstellen | Mittel |
| `/api/oauth/token` (neu) | code/refresh grants, PKCE | **Groß** |
| `src/lib/mcp/auth.ts` | 3. Zweig: OAuth-JWT → uid | Klein |
| `src/app/api/mcp/sse/route.ts` | 401 mit `WWW-Authenticate` | Klein |
| `firestore.rules` (+ Tests) | 3 Collections sperren | Klein |
| `.env.example` | `OAUTH_SIGNING_SECRET`, Basis-URL | Klein |
| `tests/` | Flow-/Rules-Tests | Mittel |

### 3.2 Reihenfolge der Implementierung

1. **OAuth-Kernbibliothek** (`src/lib/oauth/`): JWT-Sign/Verify, PKCE-Prüfung, Code-/Refresh-Store (Admin-SDK), Client-Store. + Rules für die 3 Collections.
2. **Discovery**: `/.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server`; MCP-Route 401 → `WWW-Authenticate`.
3. **DCR**: `/api/oauth/register` (+ Rate-Limit).
4. **Authorize + Consent**: `/api/oauth/authorize` (Validierung), Consent-Page (Firebase-Login), `/api/oauth/authorize/confirm` (uid + Code).
5. **Token**: `/api/oauth/token` (authorization_code, PKCE), dann refresh_token.
6. **MCP-Integration**: `authenticateMcp` akzeptiert OAuth-JWT (FA-10) — schaltet scharf.
7. **Lifecycle/Komfort**: Revocation + Settings-UI *(Soll/Kann)*.

> Schritte 1–2 sind ein Fundament-Issue; 3/4/5/6 je ein eigenständiges, sessionweise abarbeitbares Issue.

## 4. Testplan

- **Rules-Suite (`tests/firestore-rules.test.mjs`):** `oauthClients/codes/refreshTokens` für Clients nicht les-/schreibbar.
- **OAuth-Flow-Tests (neu, `tsx`/Emulator analog `test:mcp`):**
  - DCR → client_id; `/authorize` lehnt falsche `redirect_uri`/fehlende PKCE ab.
  - Code einmalig + abgelaufen → Token-Tausch scheitert; PKCE-Mismatch → Fehler.
  - JWT: gültig → uid; falsche Signatur/`aud`/abgelaufen → abgelehnt.
  - Refresh: gültig → neues Token; widerrufen → abgelehnt.
  - `authenticateMcp`: OAuth-JWT → `{user,uid}`; API-Key/Shared weiterhin ok (keine Regression).
- **Manuell (End-to-End):** claude.ai „Add custom connector" → Login/Consent → `list-spaces` liefert echte Spaces. Parallel: Claude Code mit API-Key weiterhin verbunden.

## 5. Migration / Deployment

- **Env (Vercel, Production):** `OAUTH_SIGNING_SECRET` (zufälliger 32-Byte-Wert), öffentliche Basis-URL falls nötig. `FIREBASE_SERVICE_ACCOUNT_KEY` ist gesetzt.
- **Rules-Deploy:** `npx -y firebase-tools@13 deploy --only firestore:rules` nach App-Deploy.
- **Kein Datenmodell-Bruch** an bestehenden Collections; rein additiv.
- **Reihenfolge:** Backend (AS-Endpoints) vor dem Bewerben des Web-Connectors; der API-Key-Pfad bleibt durchgehend nutzbar.
- **Voraussetzung claude.ai:** Custom Connectors sind plan-abhängig (Pro/Max/Team/Enterprise).

## 6. Referenzen

- [Konzept](01-konzept-mcp-oauth-connector.md) · [Ist-Analyse](02-ist-analyse-mcp-oauth-connector.md) · [Anforderungsanalyse](03-anforderungsanalyse-mcp-oauth-connector.md)
- Specs: OAuth 2.1, RFC 7591 (DCR), RFC 9728 (Protected Resource Metadata), RFC 8414 (AS Metadata), MCP Authorization (2025-06-18)
- Code: `src/lib/mcp/auth.ts`, `src/app/api/mcp/sse/route.ts`, `src/lib/firebase/admin.ts`, `src/lib/contexts/AuthContext.tsx`, `mcp-handler`
