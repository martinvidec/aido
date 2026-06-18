# Ist-Analyse: OAuth-Anbindung des MCP-Servers

## 1. Aktueller Zustand

### 1.1 MCP-Auth (heute)
- `src/lib/mcp/auth.ts` → `authenticateMcp(req)` akzeptiert `Authorization: Bearer <token>`:
  1. **Shared Secret** `MCP_AUTH_TOKEN` → Principal `{kind:'shared'}` (keine uid).
  2. **Persönlicher API-Key** `aido_…` → Hash-Lookup in `userApiKeys` → `{kind:'user', uid}` (uid = Doc-ID).
- Liefert `{ok:true, principal}` oder `{ok:false, response}` (401/503). **Kein OAuth, keine Discovery, kein `WWW-Authenticate`.**
- `src/app/api/mcp/sse/route.ts` (mcp-handler, stateless Streamable-HTTP) wrappt den Handler: `authenticateMcp` → `runWithPrincipal(principal, () => mcpHandler(req))`. Datentools verlangen `kind:'user'` (uid).

### 1.2 Vorhandene OAuth-Bausteine
- **`mcp-handler` (1.1.0)** exportiert **Resource-Server**-Helfer:
  - `withMcpAuth(handler, verifyToken, opts)` — prüft das Bearer-Token via `verifyToken(req, bearer) → AuthInfo|undefined`; bei `required` → 401 mit `WWW-Authenticate`; hängt `req.auth` an.
  - `protectedResourceHandler({authServerUrls, resourceUrl?})` — liefert `/.well-known/oauth-protected-resource` (RFC 9728).
  - `generateProtectedResourceMetadata(...)`, `getPublicOrigin/Url`, `metadataCorsOptionsRequestHandler()`.
  - **Liefert NICHT:** Authorization Server (kein `/authorize`, `/token`, `/register`, kein AS-Metadaten-Endpoint, keine Consent-UI, kein Token-Issuing).

### 1.3 Identität / Firebase Auth
- **Client:** `src/lib/contexts/AuthContext.tsx` — `onAuthStateChanged`, `signInWithGoogle` (Popup, `GoogleAuthProvider`), `user: User|null` (uid, displayName). Firebase-`User` hat `getIdToken()`.
- **Server:** `src/lib/firebase/admin.ts` — `getAdminAuth().verifyIdToken(idToken)` → decoded (uid). Bereits in `/api/user/apiKey` genutzt.
- Firebase ist ein **Client-seitiges** Login: die uid ist im Browser bekannt; serverseitig wird sie über ein **ID-Token** (verify) etabliert — **keine** server-lesbare Session-Cookie standardmäßig.

### 1.4 Token-/Key-Speicher
- `userApiKeys/{uid}` (Admin-only, `keyHash`/`keyPrefix`) — Vorlage für ein „nur-Hash"-Speichermuster.
- `publicProfiles/{uid}` — Anzeigename (für Consent-UI „Angemeldet als …").

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `src/lib/mcp/auth.ts` | Bearer-Auth (shared/API-Key) | **3. Zweig:** OAuth-JWT → uid |
| `src/app/api/mcp/sse/route.ts` | MCP-Route (mcp-handler) | `WWW-Authenticate`/RS-Metadaten-Verweis |
| `src/lib/firebase/admin.ts` | `getAdminAuth().verifyIdToken` | Consent: ID-Token → uid |
| `src/lib/contexts/AuthContext.tsx` | Firebase-Login (Google) | Consent-Seite |
| `src/lib/apiKeys.ts` | Hash/Token-Helfer, `rateLimit` | Wiederverwendbar (Token-Hash, Limit) |
| **neu** `/.well-known/*` Routen | Discovery-Metadaten | RS + AS Metadata |
| **neu** `/api/oauth/{authorize,token,register}` | AS-Endpoints | Auth-Code-Flow + DCR |
| **neu** Consent-Page | OAuth-Zustimmung | Firebase-Login wiederverwenden |
| **neu** Firestore-Collections | `oauthClients`, `oauthCodes`, `oauthRefreshTokens` | Clients/Codes/Refresh |
| `firestore.rules` | Regeln | neue Collections **admin-only** (kein Client-Zugriff) |

## 3. Bestehende Abhängigkeiten

- **Extern:** `mcp-handler`, `@modelcontextprotocol/sdk`, `firebase-admin` (verifyIdToken), `firebase` (Client-Login), `jose` (JWT signieren/prüfen — als Dep bereits vorhanden, ESM-import-sicher), `zod`.
- **Intern:** MCP-Route → `auth.ts` → `admin.ts`/`apiKeys.ts`; Consent-Page → `AuthContext`/Firebase.
- **Konfiguration:** `FIREBASE_SERVICE_ACCOUNT_KEY` (verifyIdToken + Admin-Firestore) — in Prod gesetzt; neu: `OAUTH_SIGNING_SECRET` (JWT-Signatur) + die öffentliche Basis-URL.

## 4. Bekannte Einschränkungen

- **Firebase ist kein OAuth-AS für Drittapps** — `/authorize`/`/token`/`/register`/Metadaten müssen selbst gebaut werden (das ist der Kernaufwand).
- **Kein server-seitiger Login-State** — die Consent-Seite muss das Firebase-ID-Token client-seitig holen und serverseitig verifizieren (kein „Cookie liest uid").
- **Admin-SDK umgeht Rules** — neue OAuth-Collections müssen in den Rules **komplett gesperrt** und nur über das Admin-SDK bedient werden (wie `userApiKeys`).
- **Stateless Serverless** — Authorization-Codes/Refresh-Tokens müssen in Firestore liegen (kein In-Memory-State, der über Instanzen hält).
- **`mcp-handler` deckt nur RS ab** — `withMcpAuth`/`protectedResourceHandler` helfen, aber der AS ist Eigenbau.

## 5. Risiken bei Änderung

- **OAuth-Sicherheit (höchstes Risiko):** PKCE (S256) zwingend prüfen, `redirect_uri` exakt gegen den registrierten Client matchen, `state` durchreichen, Auth-Codes einmalig + kurzlebig, Tokens kurzlebig + Refresh widerrufbar. Fehler hier = Account-Übernahme.
- **Token→uid-Integrität:** Ein fälschbares/zu langlebiges Access-Token unterläuft das gesamte `requireMember`-Modell (Cross-Tenant). Signatur + `aud` + `exp` strikt prüfen.
- **DCR-Missbrauch:** offener `/register` lädt zu Spam ein → Rate-Limit; nur die für den MCP-Flow nötigen Felder akzeptieren.
- **Koexistenz/Regression:** der neue Auth-Zweig darf den bestehenden API-Key-/Shared-Token-Pfad nicht brechen (Reihenfolge/Token-Form-Erkennung sauber trennen).
- **Discovery-Korrektheit:** falsche Metadaten-URLs (hinter Vercel-Proxy) → Claude findet den AS nicht. `getPublicOrigin`/`X-Forwarded-*` korrekt nutzen.
