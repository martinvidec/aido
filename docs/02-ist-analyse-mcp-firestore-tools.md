# Ist-Analyse: MCP-Server & aktuelle Datenmodelle

## 1. Aktueller Zustand

### 1.1 MCP-Server
- Endpoint `src/app/api/mcp/sse/route.ts` mit `POST` (Streamable HTTP, JSON-RPC), `GET` (SSE) und `DELETE` (Session beenden). Wegen der Node-`http`-Erwartungen des MCP-SDK werden Requests über `node-mocks-http` + `ManualMockServerResponse` (`src/lib/mcp/http-utils.ts`) geshimmt.
- Server-Info: `name: "aido-mcp-server"`, `version: "0.1.0"`. Es sind nur `tools/list` und `tools/call` registriert.
- **`tools/list`** meldet genau zwei Tools:
  - `list-todos` — input `{}`, output `{ items: [...] }`
  - `add-todo` — input `{ text: string }` (required), output Todo-Objekt
- **`tools/call`** dispatcht per `switch` auf `handleListTodosLogic` / `handleAddTodoLogic`.

### 1.2 Tool-Logik (Mock)
- `src/lib/mcp/tool-logic.ts` hält `const mockTodoStore: Record<string, {id,text,completed}> = {}` — **prozesslokal, flüchtig, keine Firestore-Anbindung**.
- `handleAddTodoLogic` legt `{ id: randomUUID(), text, completed:false }` an; `handleListTodosLogic` gibt `Object.values(mockTodoStore)` zurück.
- Antwortstruktur ist Custom (`{ result: { items } }` bzw. `{ result: newTodo }`), nicht das MCP-`content`-Blockformat.

### 1.3 Auth
- `src/lib/mcp/auth.ts` → `requireMcpAuth(req)` akzeptiert `Authorization: Bearer <token>` mit zwei Pfaden:
  1. **Shared Secret** `MCP_AUTH_TOKEN` (timing-safe Vergleich).
  2. **Persönlicher API-Key** `aido_…`: `looksLikeApiKey` → `where("keyHash","==",hashApiKey(provided))` in `userApiKeys` → bei Treffer `true`.
- **Gibt nur `null` (ok) bzw. eine Error-`NextResponse` zurück — nicht die uid.** Bei fehlender Konfiguration (weder `MCP_AUTH_TOKEN` noch Admin-SDK): `503`.
- `userApiKeys/{uid}` ist **per uid dokumentiert** (Doc-ID = uid), Felder `keyHash`, `keyPrefix`, `createdAt`, `lastUsedAt`. ⇒ Aus einem Key-Treffer ist die uid trivial ableitbar (`snapshot.docs[0].id`), wird aktuell aber verworfen.

### 1.4 Sessions
- `src/lib/mcp/session-manager.ts` hält `activeServers`/`activeTransports` in **prozesslokalen Maps**. Keine Persistenz, kein TTL.
- Der POST-Handler erzeugt bei nicht gefundener Session notfalls einen neuen Server/Transport — funktional, aber auf Vercel können `initialize` und Folge-Calls auf verschiedenen Instanzen landen.

### 1.5 Datenmodell (heute, Quelle: `firestore.rules` + `firebaseUtils.ts`)
- `spaces/{spaceId}`: `name`, `color` (number/hue), `members[]`, `createdBy`, `createdAt`. Mitglied = Voll-Lese/Schreibrecht; `createdBy/createdAt` immutable; nur Creator darf löschen.
- `spaces/{spaceId}/todos/{id}`: `spaceId`, `title`, `body` (Tiptap-JSON|null), `completed`, `waitingOn` (uid|null, **muss Mitglied sein**), `tags[]`, `mentions[]`, `createdBy` (immutable), `createdAt`, `order`. Jedes Mitglied liest/schreibt.
- `spaces/{spaceId}/daily/{id}`: `spaceId`, `text`, `completed`, `date` (`YYYY-MM-DD`, strikt), `author` (immutable), `createdAt`.
- `publicProfiles/{uid}`: `displayName`, `displayNameLower`, `photoURL`, `emailHash` (für Namensauflösung).
- Bestehende Client-Helfer (Client-SDK, rules-pflichtig) in `firebaseUtils.ts`: `getSpacesForUser`, `getTodosForSpace`/`subscribeTodosForSpace`, `createTodo`, `setTodoCompleted`, `setTodoWaitingOn`, `setTodoStatus`, `getOpenTodoCount`, Daily-CRUD. **Diese laufen client-seitig — der MCP-Server braucht Admin-SDK-Äquivalente.**

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `src/app/api/mcp/sse/route.ts` | MCP-Endpoint, Tool-Registrierung & Dispatch | Tool-Set & Antwortformat erweitern |
| `src/lib/mcp/tool-logic.ts` | Mock-Tool-Logik | **Kernumbau** → echte Firestore-Logik |
| `src/lib/mcp/schemas.ts` | Zod-Schemas der Tools | Neue Tool-Schemas (spaceId, todoId, …) |
| `src/lib/mcp/auth.ts` | Auth-Guard | Muss **uid zurückgeben** |
| `src/lib/mcp/session-manager.ts` | In-Memory-Sessions | Stateless-Betrieb absichern |
| `src/lib/firebase/admin.ts` | Admin-SDK (`getAdminDb`) | Datenzugriff bypassed Rules |
| `src/lib/apiKeys.ts` / `userApiKeys/{uid}` | Key↔uid-Mapping | uid-Auflösung |
| `firestore.rules` | Sicherheitsmodell | **Referenz** für serverseitige Checks |
| `src/lib/firebase/firebaseUtils.ts` | Client-Datenhelfer | Vorlage für Admin-Äquivalente |

## 3. Bestehende Abhängigkeiten

- **Extern:** `@modelcontextprotocol/sdk` (Streamable HTTP/Server), `firebase-admin` (Firestore/Auth), `node-mocks-http`, `zod` (v4), Web-Streams-Polyfills.
- **Intern:** Auth → `apiKeys`/`admin`; Tool-Logik (künftig) → `admin`; Route → Schemas + Tool-Logik + Session-Manager + Auth.
- **Konfiguration:** Persönliche Keys funktionieren nur mit gesetztem `FIREBASE_SERVICE_ACCOUNT_KEY` (sonst `getAdminDb() === null` → 503).

## 4. Bekannte Einschränkungen

- **Admin-SDK umgeht `firestore.rules` vollständig** — jede Autorisierung (Membership, `createdBy`, `waitingOn`-Mitgliedschaft, Feldtypen) muss im Tool-Code nachgebaut werden.
- **Keine uid im Auth-Pfad** (heutiger Stand) → ohne Refactor keine nutzerbezogenen Tools möglich.
- **Session-Map nicht durable** (Vercel) — funktioniert lokal, kann serverless brechen.
- **Shared-Token hat keine uid** → für Datentools ungeeignet.
- Antwortformat aktuell Custom statt MCP-`content`-Blöcke → manche Clients erwarten den Standard.
- Zod v4 + `setRequestHandler` stoßen an TS-Rekursionslimits (siehe Kommentare in `schemas.ts`) — neue Schemas müssen demselben „standalone object"-Muster folgen.

## 5. Risiken bei Änderung

- **Sicherheit (höchstes Risiko):** Ein fehlender Membership-Check im Admin-Pfad würde Cross-Tenant-Zugriff erlauben (Rules greifen hier nicht). Jede Tool-Operation muss die Space-Mitgliedschaft der uid prüfen, bevor sie liest/schreibt.
- **Konsistenz mit Rules:** Schreibt ein Tool z. B. `waitingOn` = Nicht-Mitglied oder ein falsches Feldformat, entstehen Datensätze, die der Client/​die Rules sonst nie erzeugen würden (Board/Counts brechen). Tools müssen `hasValidWaitingOn`, `hasValidTodoFields`, Daily-`date`-Regex etc. spiegeln.
- **Bestehende Clients:** Wer heute `list-todos`/`add-todo` (Mock, ohne `spaceId`) nutzt, bricht bei Signaturwechsel. Mitigation: bewusster Breaking Change dokumentieren (das Mock-Tool war nie produktiv).
- **Serverless:** Bei beibehaltener In-Memory-Session können `initialize`→`tools/call` divergieren; Datentools müssen ohne Cross-Request-State korrekt sein.
- **Kosten/Last:** Ungebremste Schreibtools laden zu Key-Churn/Spam ein → Rate-Limit nötig.
