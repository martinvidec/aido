# Konzept: MCP-Tools an die echten App-Features (Firestore) anbinden

## 1. Zusammenfassung

Der MCP-Endpoint (`/api/mcp/sse`) bietet heute nur zwei Demo-Tools (`list-todos`, `add-todo`) auf einem flüchtigen In-Memory-Mock ohne jede Verbindung zu den echten Daten. Dieses Konzept beschreibt, den MCP-Server so umzubauen, dass seine Tools über das Firebase Admin-SDK auf die **realen, aktuellen** Datenmodelle der App zugreifen — Spaces, space-scoped Todos und Daily/„Heute" — und dabei strikt auf den Besitzer des verwendeten persönlichen API-Keys (uid) eingegrenzt sind.

## 2. Problemstellung

- Die MCP-Tools arbeiten auf `mockTodoStore` (`src/lib/mcp/tool-logic.ts`) — sie sehen weder Spaces noch echte Todos. Externe Tools (z. B. Claude) können die App faktisch nicht steuern.
- Das Tool-Vokabular (`list-todos`/`add-todo` ohne Space) entspricht dem **alten**, vor-Redesign Datenmodell („My Todos"). Die App ist seit Epic #38 aber **Spaces-zentriert** (`spaces/{id}/todos`, `spaces/{id}/daily`).
- Der Auth-Guard (`requireMcpAuth`) verifiziert zwar einen persönlichen API-Key, **gibt aber die zugehörige uid nicht zurück** — ohne uid kann kein Tool „nur meine Daten" durchsetzen.
- Sessions liegen in einer prozesslokalen Map (`session-manager.ts`) → auf Vercel (serverless) nicht stabil über Instanzen hinweg.

## 3. Zielsetzung

- MCP-Tools greifen auf die **echten** Firestore-Daten zu (Spaces/Todos/Daily), nicht auf einen Mock.
- Das Tool-Set ist an die **heutigen** Features angepasst: Spaces auflisten, Todos je Space lesen/anlegen/abschließen, „wartet auf" setzen, Daily lesen/anlegen.
- **Sicherheit:** Jeder Datenzugriff ist an die uid des persönlichen API-Keys gebunden; ein Nutzer sieht/ändert ausschließlich Spaces, in denen er Mitglied ist. Die Tools spiegeln die Constraints der `firestore.rules` (Admin-SDK umgeht die Rules — die Prüfungen müssen daher im Tool-Code passieren).
- Messbar: Ein per persönlichem Key verbundener Client kann (a) seine Spaces listen, (b) in einem Space Todos lesen und anlegen, (c) ein Todo abschließen — und kann nachweislich **nicht** auf fremde Spaces zugreifen.

## 4. Lösungsidee

1. **Auth liefert die uid.** `requireMcpAuth` → `authenticateMcp(req)`, das bei persönlichem Key die uid (aus der Doc-ID von `userApiKeys`) zurückgibt; beim Shared-Token einen uid-losen Kontext. Datentools verlangen eine uid.
2. **Firestore-gebundene Tool-Logik** über das Admin-SDK (`getAdminDb()`), in neuen Helfern, die die Rules-Constraints serverseitig nachbilden (Membership-Check via `spaces/{id}.members`, `createdBy`/`author` = uid, `waitingOn` muss Mitglied sein, Feldvalidierung).
3. **Neues Tool-Set** (an die Features angepasst): `list-spaces`, `list-todos` (pro Space), `add-todo`, `complete-todo`, `set-waiting-on`, `list-daily`, `add-daily`.
4. **Sessions entschärfen:** Datentools stateless/idempotent gestalten (jeder `tools/call` in sich abgeschlossen), sodass die nicht-durable Session-Map keine korrekten Antworten verhindert; echte SSE-Streams (sticky sessions / externer Store) bleiben außen vor.

## 5. Betroffene Komponenten

| Bereich | Datei(en) |
|---|---|
| MCP-Auth | `src/lib/mcp/auth.ts` |
| Tool-Schemas | `src/lib/mcp/schemas.ts` |
| Tool-Logik (Mock → echt) | `src/lib/mcp/tool-logic.ts` |
| Tool-Registrierung (`tools/list`, `tools/call`) | `src/app/api/mcp/sse/route.ts` |
| Session-Handling | `src/lib/mcp/session-manager.ts` |
| Datenzugriff (Admin) | `src/lib/firebase/admin.ts`, neue `src/lib/mcp/data.ts` (o. ä.) |
| API-Keys (uid↔Key) | `src/lib/apiKeys.ts`, `userApiKeys/{uid}` |
| Sicherheitsreferenz | `firestore.rules` (Spiegelung im Tool-Code) |

## 6. Abgrenzung

**Nicht** Teil dieser Anforderung:
- Keine MCP-Tools zum **Anlegen/Löschen von Spaces** oder **Mitglieder einladen/entfernen** (sicherheitssensibel; bleibt UI-exklusiv).
- Keine Kontakte-/`publicProfiles`-Verwaltung über MCP (nur lesende Namensauflösung für Anzeige, falls nötig).
- Keine Änderung am Firestore-Datenmodell oder an den `firestore.rules` (die Tools nutzen das bestehende Modell).
- Kein echtzeitfähiges Streaming/Subscriptions über MCP; keine vollständige Lösung der serverless-Session-Persistenz (nur Entschärfung).
- Keine Migration der Legacy-`users/{uid}/todos`.

## 7. Entscheidungen (Review-Ergebnis)

Im Review bestätigt:

1. **Shared-Token bei Datentools:** ❌ **Nicht erlaubt.** Datentools verlangen einen persönlichen Key (→ uid → nur eigene Spaces). `MCP_AUTH_TOKEN` (ohne uid) bleibt nur für Transport-/operative Zwecke und wird von Datentools abgelehnt.
2. **Schreibumfang:** ✅ **Nur Todos + Daily.** Spaces anlegen/löschen und Mitglieder einladen/entfernen bleiben UI-exklusiv (sicherheitssensibel).
3. **`list-todos`-Scope:** ✅ **Immer mit explizitem `spaceId`**, plus `list-spaces` zum Discovern.
4. **Session-Persistenz:** ✅ **Stateless jetzt.** Datentools idempotent/ohne Cross-Request-State; echtes SSE-Streaming bzw. externer Session-Store ist ein separates Folge-Thema.
5. **Rate-Limiting:** ✅ Leichtgewichtig pro uid für Schreibtools (analog `apiKeys.ts` `rateLimit`).
6. **Antwortformat:** ✅ MCP-konforme `content`-Blöcke statt der heutigen Custom-`{ result: … }`-Struktur.
