# Konzept: OAuth für den aido-MCP-Server (Claude.ai Web-Connector)

## 1. Zusammenfassung

Der aido-MCP-Server (`/api/mcp/sse`) soll als **Custom Connector auf claude.ai (Web)** verbindbar werden. Das erfordert, dass der Server den **OAuth-2.1-/MCP-Authorization-Flow** unterstützt (Discovery-Metadaten, Authorization-Code-Flow mit PKCE, i. d. R. Dynamic Client Registration), statt wie heute nur einen statischen persönlichen API-Key als Bearer-Header zu akzeptieren. Der bestehende API-Key-Pfad (Claude Code / Desktop) bleibt parallel erhalten.

## 2. Problemstellung

- Claude Code und Claude Desktop können einen statischen `Authorization: Bearer aido_…`-Header mitschicken — das funktioniert bereits.
- **claude.ai-Custom-Connectors** bieten dafür **kein Eingabefeld**: Sie verbinden einen remote MCP-Server per URL und authentifizieren über **OAuth** (MCP-Authorization-Spec, 2025-06-18) — oder gar nicht. Ohne Auth lehnen die Datentools mangels uid ab.
- aido hat heute **keinen OAuth-Server**: `authenticateMcp` macht nur einen Hash-Lookup des persönlichen Keys → uid.

## 3. Zielsetzung

- aido lässt sich auf claude.ai als Custom Connector hinzufügen; der Nutzer durchläuft einen Login/Consent und ist danach mit **seiner** Identität (uid) verbunden.
- Jeder Tool-Call ist wie bisher an die uid gebunden (nur eigene Spaces) — das bestehende `requireMember`/uid-Modell wird **wiederverwendet**, nur die Token-Quelle ändert sich.
- **Koexistenz:** Persönlicher API-Key (Code/Desktop) **und** OAuth (Web) funktionieren gleichzeitig am selben Endpoint.
- Messbar: Der „Add custom connector"-Flow auf claude.ai schließt erfolgreich ab, und ein Tool-Call (`list-spaces`) liefert die echten Spaces des angemeldeten Nutzers.

## 4. Lösungsidee

MCP-Authorization trennt zwei Rollen:
- **Resource Server (RS)** = der MCP-Endpoint: validiert Access-Tokens, weist via `WWW-Authenticate` + `/.well-known/oauth-protected-resource` auf den Authorization Server hin. **Dafür bringt `mcp-handler` bereits Bausteine mit** (`withMcpAuth`, `protectedResourceHandler`, `generateProtectedResourceMetadata`).
- **Authorization Server (AS)** = Login/Consent, Token-Endpoint, Metadaten, **Dynamic Client Registration (DCR)**. **Das liefert `mcp-handler` NICHT** — der AS muss von aido kommen.

Der Kern der Entscheidung liegt also beim **AS**. Drei Wege (siehe Offene Fragen):
- **(a) Eigener minimaler OAuth-AS in Next.js** — Authorization-/Token-/Registrierungs-Endpoints selbst implementieren, Login über die bestehende Firebase-Google-Anmeldung, Tokens selbst ausgeben (z. B. signierte JWTs oder opake Tokens in Firestore).
- **(b) Firebase Auth / Google als Identitätsquelle** mit dünnem OAuth-Layer — die Nutzer-Authentifizierung macht Firebase (Google-Login, schon vorhanden), aido baut nur den OAuth-Wrapper (Endpoints/Consent/DCR) darum.
- **(c) Externer IdP davor** (Auth0 / WorkOS / Stytch / Scalekit o. ä.) als fertiger AS inkl. DCR — aido ist nur RS und mappt das Token → uid.

In allen Fällen: Access-Token → uid auflösen, dann in den **bestehenden** `runWithPrincipal({kind:'user',uid})`-Pfad einspeisen; der Rest (Tools, `requireMember`) bleibt unverändert.

## 5. Betroffene Komponenten

| Bereich | Datei(en) | Rolle |
|---|---|---|
| MCP-Auth-Guard | `src/lib/mcp/auth.ts` (`authenticateMcp`) | Zweiter Auth-Pfad: OAuth-Token → uid |
| MCP-Route | `src/app/api/mcp/sse/route.ts` | `WWW-Authenticate`/RS-Metadaten; ggf. `withMcpAuth` |
| OAuth-Metadaten | **neu:** `/.well-known/oauth-protected-resource`, ggf. `/.well-known/oauth-authorization-server` | Discovery |
| OAuth-AS-Endpoints (bei a/b) | **neu:** `/authorize`, `/token`, `/register` (DCR) | Auth-Code-Flow, Token, Client-Registrierung |
| Login/Consent-UI (bei a/b) | **neu:** Consent-Seite; nutzt bestehende `AuthContext`/Firebase-Login | Nutzer-Zustimmung |
| Token-Speicher | Firestore (neue Collections) bzw. JWT-Signaturschlüssel | Codes/Tokens/Clients |
| Identität | `src/lib/contexts/AuthContext.tsx`, Firebase Auth | Wer ist der Nutzer (uid) |
| Bestehender Key-Pfad | `userApiKeys`, `src/lib/apiKeys.ts` | bleibt unverändert |

## 6. Abgrenzung

**Nicht** Teil dieser Anforderung:
- Kein Ersatz/Abbau des persönlichen API-Key-Pfads (Code/Desktop) — der bleibt.
- Keine neuen MCP-Tools, keine Änderung am Datenmodell der Spaces/Todos.
- Kein allgemeiner „aido-OAuth-Provider für Drittapps" über den MCP-Use-Case hinaus (nur so weit, wie der Connector es braucht).
- Keine Multi-Tenant-/Org-Verwaltung, keine Scopes jenseits eines einfachen Modells (sofern in den Offenen Fragen nicht anders entschieden).

## 7. Entscheidungen (Review-Ergebnis)

1. **Authorization-Server-Ansatz:** ✅ **(b) Firebase-basiert.** aido baut die OAuth-AS-Endpoints selbst, die **Nutzer-Authentifizierung** kommt aber aus der bestehenden Firebase-**Google**-Anmeldung. Kein Fremd-IdP.
   > Wichtige Klarstellung: Firebase macht aido zum OAuth-**Client** (Konsument von Google). Für den Connector muss aido OAuth-**Provider** (Authorization Server für Claude) sein — die umgekehrte Rolle. Firebase liefert Login/Identität (uid), aber **nicht** die AS-Endpoints `/authorize`/`/token`/`/register`/Metadaten, mit denen Claude spricht. Genau die werden gebaut.
2. **Dynamic Client Registration:** ✅ **Ja** (`/register`) — Claude registriert sich dynamisch; Client-Daten in Firestore.
3. **Token-Format:** ✅ **Kurzlebiges signiertes JWT-Access-Token** (HS256, Signaturschlüssel aus Env; `sub`=uid, `exp`, `aud`, `scope`, `client_id`) — vom MCP-Endpoint per Signatur+`exp` validiert (kein Firestore-Lookup pro Request). Dazu **opakes Refresh-Token in Firestore** (widerrufbar, längere Laufzeit).
4. **Login-Quelle für Consent:** ✅ Bestehende Firebase-**Google**-Anmeldung. Die Consent-Seite ist eine Client-Seite (nutzt `AuthContext`); sie holt das Firebase-ID-Token (`user.getIdToken()`), das ein Server-Endpoint per `verifyIdToken` → uid prüft, bevor ein Auth-Code ausgestellt wird.
5. **Scope-Modell:** ✅ **Ein Scope zum Start** — `aido.tools` („volle Tool-Nutzung auf eigene Spaces"). Feinere Scopes (read/write) sind später additiv möglich. *(Default; im Review anpassbar.)*
6. **Token→uid:** ✅ Das Access-Token (`sub`) trägt die uid; sie bleibt die **alleinige** Autorisierungsbasis (wie beim API-Key). `requireMember`/Tools unverändert.
7. **Koexistenz:** ✅ Der persönliche **API-Key-Pfad bleibt** (Code/Desktop). `authenticateMcp` bekommt einen dritten Zweig: OAuth-JWT → uid, zusätzlich zu Shared-Token und API-Key.
