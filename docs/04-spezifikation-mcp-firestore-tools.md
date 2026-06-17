# Spezifikation: Firestore-gebundene MCP-Tools

## 1. Übersicht

Der MCP-Server wird von einem Mock auf echten Firestore-Zugriff (Admin-SDK) umgestellt. Kern ist (1) ein Auth-Refactor, der die **uid** des persönlichen API-Keys liefert, (2) eine **Datenzugriffsschicht**, die die `firestore.rules`-Constraints serverseitig spiegelt (Admin-SDK umgeht die Rules), und (3) ein an die heutigen Features angepasstes **Tool-Set** rund um Spaces/Todos/Daily. Umgesetzt in Schritten gemäß Anforderungsanalyse (Fundament → Lesen → Schreiben → Daily).

## 2. Technisches Design

### 2.1 Architektur

```
Client (Bearer aido_…)
   │  POST /api/mcp/sse  (tools/call)
   ▼
route.ts ── authenticateMcp(req) ─▶ { uid } | { shared:true } | 401/503
   │            (uid via userApiKeys Doc-ID)
   ▼
tools/call dispatch ─▶ tool-logic (pro Tool)
   │                      │ requireMember(uid, spaceId)  ◀─ Admin getAdminDb()
   │                      │ Rules-Parität (createdBy, waitingOn∈members, Feldtypen)
   ▼                      ▼
MCP content-Antwort ◀── Firestore (spaces/{id}/todos|daily, publicProfiles)
```

### 2.2 Datenmodell

**Keine Änderungen** am Firestore-Schema und an `firestore.rules`. Die Tools nutzen die bestehenden Collections (`spaces`, `spaces/{id}/todos`, `spaces/{id}/daily`, `publicProfiles`, `userApiKeys`). `userApiKeys/{uid}` (Doc-ID = uid) bleibt die Quelle der uid-Auflösung.

### 2.3 Schnittstellen

**(a) Auth** — `src/lib/mcp/auth.ts`
```ts
type McpPrincipal = { kind: 'user'; uid: string } | { kind: 'shared' };
// null bei nicht-konfiguriert/unautorisiert wird durch ein Result-Objekt ersetzt:
async function authenticateMcp(req): Promise<
  | { ok: true; principal: McpPrincipal }
  | { ok: false; response: NextResponse }   // 401/503
>;
// matchesPersonalApiKey gibt künftig die uid (snapshot.docs[0].id) zurück.
// requireMcpAuth bleibt als dünner Wrapper (Transport-Auth) erhalten.
```

**(b) Datenzugriffsschicht** — neu, `src/lib/mcp/data.ts` (Admin-SDK)
```ts
async function requireMember(uid, spaceId): Promise<SpaceDoc>;     // wirft McpToolError, wenn kein Mitglied
async function listSpacesForUid(uid): Promise<SpaceSummary[]>;     // + openCount via getCountFromServer
async function listTodos(uid, spaceId, opts): Promise<TodoView[]>;
async function addTodo(uid, spaceId, input): Promise<TodoView>;    // createdBy=uid, order=max+1, tags/mentions, waitingOn∈members
async function setTodoCompleted(uid, spaceId, todoId, completed): Promise<TodoView>;
async function setWaitingOn(uid, spaceId, todoId, userId|null): Promise<TodoView>;
async function listDaily(uid, spaceId, date?): Promise<DailyView[]>;
async function addDaily(uid, spaceId, text): Promise<DailyView>;
```
Jede Funktion ruft zuerst `requireMember`. Schreibfunktionen prüfen die Rules-Parität (siehe NFA-02). `McpToolError` (mit Code: `unauthorized`/`not_found`/`invalid`) wird im Dispatch in eine MCP-Fehlerantwort übersetzt.

**(c) Tools** (`inputSchema`, alle `spaceId` required wo angegeben)

| Tool | Input | Wirkung |
|---|---|---|
| `list-spaces` | `{}` | Spaces der uid + openCount |
| `list-todos` | `{ spaceId, includeCompleted?, tag? }` | Todos des Space |
| `add-todo` | `{ spaceId, title, bodyText?, waitingOn? }` | Todo anlegen |
| `complete-todo` | `{ spaceId, todoId, completed }` | Completion setzen |
| `set-waiting-on` | `{ spaceId, todoId, userId\|null }` | „wartet auf" setzen |
| `list-daily` | `{ spaceId, date? }` | Heute-Items |
| `add-daily` | `{ spaceId, text }` | Heute-Item anlegen |
| `delete-todo` *(Kann)* | `{ spaceId, todoId }` | Todo löschen |
| `whoami` *(Kann)* | `{}` | uid + Anzeigename |

**Antwortformat:** MCP-`content`-Block mit menschenlesbarem Text **und** maschinenlesbarem JSON, z. B.
`{ content: [{ type: 'text', text: '<JSON oder Zusammenfassung>' }] }`.

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `src/lib/mcp/auth.ts` | `matchesPersonalApiKey` → uid; `authenticateMcp` mit Principal | Klein |
| `src/lib/mcp/data.ts` (neu) | Admin-Datenzugriff + Membership/Rules-Parität | **Groß** |
| `src/lib/mcp/tool-logic.ts` | Mock entfernen; Handler je Tool auf `data.ts` | Mittel |
| `src/lib/mcp/schemas.ts` | Neue Zod-Schemas (standalone-Muster) | Mittel |
| `src/app/api/mcp/sse/route.ts` | `tools/list`-Array + `tools/call`-Dispatch + Principal/Fehler-Mapping | Mittel |
| `src/lib/mcp/session-manager.ts` | Stateless-Betrieb dokumentieren/absichern (kein Cross-Request-State) | Klein |
| `src/lib/apiKeys.ts` | ggf. `rateLimit`-Key-Schema für MCP-Writes wiederverwenden | Klein |
| `tests/` | MCP-Tool-Tests (Emulator) | Mittel |

### 3.2 Reihenfolge der Implementierung

1. **Auth-Refactor (FA-01/02):** uid aus Key; `authenticateMcp`; Datentools verlangen uid.
2. **Datenschicht-Fundament (FA-03):** `data.ts` mit `requireMember` + Admin-Helfern; `McpToolError`.
3. **Lese-Tools (FA-04/05/12):** `list-spaces`, `list-todos`; `tools/list` + Dispatch + content-Format.
4. **Schreib-Tools (FA-06/07/08):** `add-todo`, `complete-todo`, `set-waiting-on` inkl. Rules-Parität + Rate-Limit.
5. **Daily (FA-09/10):** `list-daily`, `add-daily`.
6. **Komfort (FA-11/13/14, Kann):** Format-Feinschliff, `delete-todo`, `whoami`/`list-members`.

> **Hinweis Reihenfolge:** Schritte 1–2 sind ein gemeinsames Fundament-Issue; ab Schritt 3 ist jedes Tool(-Cluster) ein eigenständiges, sessionweise abarbeitbares Issue.

## 4. Testplan

- **Security-Rules-Suite (`tests/`, Emulator):** unverändert grün halten (keine Rules-Änderung).
- **MCP-Tool-Tests (neu, Emulator + Admin-SDK):**
  - `requireMember`: Mitglied → ok; Nicht-Mitglied → `unauthorized`; unbekannter Space → `not_found`.
  - `add-todo`: `createdBy=uid`, `order=max+1`, `tags`/`mentions` abgeleitet; `waitingOn` Nicht-Mitglied → `invalid`.
  - `complete-todo`/`set-waiting-on`: korrekte Felder, kein verwaister `waitingOn`.
  - `add-daily`: `date`-Regex, `author=uid`.
  - Auth: persönlicher Key → uid; Shared-Token → Datentool abgelehnt; fehlendes Admin-SDK → 503/Fehler.
- **Manuell:** Claude/`mcp-remote` mit persönlichem Key → `list-spaces` → `add-todo` → in Web-UI verifizieren (und umgekehrt).
- **Negativ/Isolation:** Zwei Test-uids; sicherstellen, dass uid A `spaceId` von B weder lesen noch schreiben kann.

## 5. Migration / Deployment

- **Breaking Change:** `list-todos`/`add-todo` ändern Signatur (jetzt `spaceId`-pflichtig). Das alte Verhalten war nur ein Mock — im Changelog/PR klar kennzeichnen.
- **Voraussetzung:** `FIREBASE_SERVICE_ACCOUNT_KEY` muss im Deployment gesetzt sein (sonst Datentools 503). `.env.example` ggf. ergänzen/kommentieren.
- **Reihenfolge:** App-Deploy vor Bewerbung der neuen Tools; keine Rules-Deployments nötig.
- **Session/Serverless:** Tools stateless halten; falls später echtes SSE-Streaming gewünscht ist, ist Sticky-Session bzw. externer Session-Store ein **separates** Folge-Thema (außerhalb dieser Spec).

## 6. Referenzen

- [Konzeptdokument](01-konzept-mcp-firestore-tools.md)
- [Ist-Analyse](02-ist-analyse-mcp-firestore-tools.md)
- [Anforderungsanalyse](03-anforderungsanalyse-mcp-firestore-tools.md)
- Code: `src/app/api/mcp/sse/route.ts`, `src/lib/mcp/{auth,tool-logic,schemas,session-manager}.ts`, `src/lib/firebase/admin.ts`, `src/lib/apiKeys.ts`, `firestore.rules`
