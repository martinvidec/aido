# Ist-Analyse: Todos an eine Claude-Code-Session binden und abarbeiten lassen

Bezug: [Konzept](01-konzept-aido-sessions.md). Diese Analyse hält den heutigen Stand der
Codebasis gegen die im Konzept geplanten Bausteine (Sessions, `next-todo` mit Claim/Lease,
`update-todo` Markdown→Tiptap, Attach-UI, Settings, Allowlist).

## 1. Aktueller Zustand

### 1.1 MCP-Server (Pull-Schicht)

- **Transport:** `src/app/api/mcp/sse/route.ts` nutzt `createMcpHandler` (`mcp-handler`) im
  **stateless** Streamable-HTTP-Modus (`disableSse: true`). Tools werden **inline** mit Zod-Schemas
  registriert (`server.tool(name, desc, schema, handler)`, Zeilen 45–111); die SDK validiert die
  Eingaben **vor** dem Handler. `safe()` (Z. 33–41) mappt `McpToolError` → `errorResult`.
  > Hinweis: Der Kommentar in `CLAUDE.md` über einen in-memory Session-Map / `node-mocks-http`-Shim
  > ist **veraltet** — der aktuelle Endpoint ist stateless.
- **Auth:** `src/lib/mcp/auth.ts` → `authenticateMcp` liefert `McpPrincipal = {kind:'user',uid} |
  {kind:'shared'}`. Drei Credential-Typen: Shared-Secret (`MCP_AUTH_TOKEN`, identitätslos),
  Personal-API-Key (`aido_…`, SHA-256-Hash-Lookup in `userApiKeys`, doc-id = uid) und OAuth-JWT
  (claude.ai-Connector). **Daten-Tools brauchen `kind:'user'`** (`requireUserUid` in
  `tool-logic.ts:34`).
- **Per-Request-Identität:** `src/lib/mcp/context.ts` bindet den Principal via `AsyncLocalStorage`
  an den Request (nicht an die Session-id — bewusst, Z. 4–11).
- **Daten-/Member-Gate:** `src/lib/mcp/data.ts` (Admin SDK) — `requireMember(uid, spaceId)`
  (Z. 103) ist das Tor jedes per-User-Tools; alle Reads/Writes sind **pro Space**. Schreib-Tools
  laufen durch `enforceWriteRateLimit` (30/min/uid, `tool-logic.ts:48`).
- **Vorhandene Tools:** `list-spaces`, `list-todos`, `add-todo`, `complete-todo`, `set-waiting-on`,
  `list-daily`, `add-daily`, `delete-todo`, `whoami`, `list-members`.

### 1.2 Lücken gegenüber dem Konzept (MCP)

- **`TodoView` (`data.ts:52`) enthält keinen `body`** — nur `id/title/completed/waitingOn/tags/
  order`. Claude kann die eigentliche Aufgabe/Frage **nicht lesen**. → `next-todo`/`get` müssen den
  Body liefern.
- **Kein Schreib-Tool für `title`/`body`.** `addTodo` erzeugt den Body nur aus Plain-Text
  (`bodyFromText`, `data.ts:214` → ein Paragraph) — **keine Codeblöcke**. → `update-todo` fehlt
  komplett.
- **Keine Session-Begriffe** (Registrierung, Bindung, Claim, Lease, Turn) — alles neu.
- **Kein `collectionGroup`-Query** in `src/` (bestätigt) und **keine `firestore.indexes.json`**.
  `next-todo` ist das **erste** space-übergreifende Query-Muster und braucht einen
  Collection-Group-(Composite-)Index, den es heute nicht gibt.

### 1.3 Datenmodell & Sicherheitsregeln

- **Todo** (`src/lib/types.ts:32`): `spaceId, title, body (TiptapContent|null), completed,
  waitingOn (uid|null), tags[], mentions[], createdBy, modifiedBy, createdAt, order`. **Kein**
  `assignedTo`/Session-/Turn-/Claim-Feld.
- **Regeln** (`firestore.rules`, `match /todos/{todoId}`): jedes Mitglied darf create/update/delete;
  `modifiedBy == auth.uid` Pflicht; `createdBy` immutabel; `waitingOn` null oder Mitglied; **`body`
  ist bereits als `map|null` erlaubt** (`hasValidTodoFields`). Die Regeln **prüfen die bekannten
  Felder per Shape**, beschränken aber **nicht** auf einen geschlossenen Schlüssel-Satz — neue
  Felder wären schreibbar, aber **unvalidiert**.
- **Sessions:** keine Collection vorhanden. `users/{uid}` ist **owner-only** und trägt heute schon
  Settings (theme, notifications, language, timezone) ohne Feld-Enumeration in den Regeln — d.h.
  ein Lease-TTL-Default ließe sich dort **ohne** Regeländerung ablegen.

### 1.4 Rich-Text (Tiptap)

- **Codeblöcke sind bereits aktiviert.** `useTiptapConfig` (`src/lib/hooks/useTiptapConfig.ts`)
  registriert `CustomCodeBlock` (Z. 25–54, 147), Listen, TaskList/TaskItem, Underline, gehärtete
  `Link` (Allowlist via `linkSecurity`), Highlight, Mention, Hashtag. **Inline-`code` ist
  deaktiviert** (`code:false`, Z. 131). Read-only-Render läuft XSS-sicher über `<EditorContent>`
  (`TodoBody.tsx`), Edit über `TodoEditor.tsx`.
- **Aber:** `useTiptapConfig` ist ein **Client-/React-Hook** (`@tiptap/react`, `getContacts`) — im
  **serverseitigen** Admin-Kontext der MCP-Tools **nicht nutzbar**. Es gibt **keine
  Markdown↔Tiptap-Konvertierung** und **keine** Serializer-Library in `package.json`
  (`tiptap-markdown`/`prosemirror-markdown`/`marked`/`markdown-it` — alle nicht vorhanden). Der
  einzige Text→Tiptap-Pfad ist `bodyFromText` (Plain-Text). → Markdown→Tiptap (inkl. Codeblock) ist
  **Greenfield** und muss als eigenständige, vom React-Editor unabhängige Funktion entstehen, die
  **nur die oben erlaubten Node-/Mark-Typen** erzeugt.

### 1.5 Web-UI & Client-Schreibwege

- **Aktion-Muster „Verschieben…"** (#201/#202) ist die Blaupause für „An Session anhängen…":
  - Liste: `src/components/shell/list/TodoActions.tsx` öffnet `MoveToSpaceMenu`
    (`src/components/shell/MoveToSpaceMenu.tsx`, ruft `TodosContext.moveTodo`).
  - Board: `src/components/shell/board/TodoCard.tsx` (`onMoveToSpace`) → `BoardView.tsx` öffnet
    `MoveToSpaceMenu` in einer `BottomSheet`.
- **`TodosContext`** (`src/lib/contexts/TodosContext.tsx`) abonniert `spaces/{spaceId}/todos` live
  (`subscribeTodosForSpace`, orderBy `order`) und exponiert `createTodo/editContent/setCompleted/
  setWaitingOn/setStatus/remove/moveTodo` + Tag-Filter. **Pro aktivem Space**, nicht
  space-übergreifend.
- **`firebaseUtils`** Schreibhelfer (`createTodo`, `editTodoContent`, `setTodoCompleted`,
  `setTodoWaitingOn`, `setTodoStatus`, `deleteTodo`, `moveTodoToSpace`) setzen **alle**
  `modifiedBy: uid` und leiten `tags`/`mentions` neu ab (`deriveTags`/`deriveMentions`).
- **Settings:** `src/components/UserSettings.tsx` schreibt `users/{uid}` via `updateDoc` und bindet
  `ApiKeySettings` + `SessionSettings` ein. **Namenskollision:** `SessionSettings.tsx` /
  `tests/device-login.test.mts` / `/api/auth/sessions/revoke` meinen **Geräte-/Login-Sessions** —
  ein völlig anderes Konzept als die hier geplanten **Claude-Code-Sessions**. Die neue UI braucht
  einen **eindeutig anderen Namen** (z.B. „Agent-Sessions" / „Claude-Code-Sessions").

### 1.6 Tests

- Emulator-basiert in `tests/`: `firestore-rules.test.mjs` (Rules), `mcp-tools.test.mts`
  (`npm run test:mcp`, fährt echten `src/lib/mcp/*`-Code gegen den Emulator), zusätzlich
  `device-login`, `migration-admin`, `oauth`, `storage-rules`. Neue Tools/Felder müssen hier
  mitgezogen werden (Rules **und** MCP-Tool-Tests, je in Parität).

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `src/app/api/mcp/sse/route.ts` | Tool-Registrierung (inline Zod), stateless Handler | Neue Tools `register-session`/`next-todo`/`update-todo`/`handoff` registrieren |
| `src/lib/mcp/tool-logic.ts` | Handler, `requireUserUid`, Rate-Limit | Neue Handler + Allowlist-Enforcement |
| `src/lib/mcp/data.ts` | Admin-SDK-Datenzugriff, `requireMember`, `TodoView` | Session-Funktionen, Claim/Lease (Transaction), `collectionGroup`-Query, Body in View |
| `src/lib/mcp/auth.ts` / `context.ts` | Principal (uid) je Request | Session-Identität aus uid + host+cwd ableiten; unverändert |
| `firestore.rules` | Autorität des Datenmodells | `users/{uid}/sessions`; Validierung `attachedSession`/`aidoTurn`/`claimedBy`/`claimedAt` |
| `tests/firestore-rules.test.mjs` | Rules-Tests | Neue Felder/Collection abdecken |
| `tests/mcp-tools.test.mts` | MCP-Tool-Tests gg. Emulator | Claim/Lease/Allowlist/`update-todo` abdecken |
| `src/lib/types.ts` | `Todo`-Typ | `Session`-Typ; Todo-Felder ergänzen |
| **`firestore.indexes.json` (fehlt)** | Index-Definitionen | **Neu anlegen** für Collection-Group-Index `next-todo` |
| `src/lib/tiptap/linkSecurity.ts` | Link-Allowlist | Von Markdown→Tiptap wiederverwenden |
| (neu) `src/lib/tiptap/markdown.ts` | — existiert nicht — | Markdown↔Tiptap (serverfähig, nur erlaubte Nodes) |
| `src/lib/hooks/useTiptapConfig.ts` | Client-Editor-Config (CodeBlock aktiv) | Referenz für erlaubte Node-/Mark-Typen; **nicht** serverseitig nutzbar |
| `src/components/shell/list/TodoActions.tsx`, `shell/MoveToSpaceMenu.tsx` | Listen-Aktionen/Picker | Muster für „An Session anhängen…", „Zurück an aido" |
| `src/components/shell/board/{TodoCard,BoardView}.tsx` | Board-Karte/Aktionen | Attach/Status auf Karten |
| `src/lib/contexts/TodosContext.tsx` | Todo-CRUD + Live-Abo (pro Space) | Attach/Turn-Setter, Status-Badge, ggf. Filter |
| `src/lib/firebase/firebaseUtils.ts` | Schreibhelfer (setzen `modifiedBy`) | `bindTodoToSession`/`returnToAido` ergänzen |
| `src/components/UserSettings.tsx` | Settings-Schreibweg `users/{uid}` | Lease-TTL-Default; Einbinden des Sessions-Panels |
| `src/components/SessionSettings.tsx` | **Geräte-Login**-Sessions | **Namenskollision** — neue Komponente klar abgrenzen |

## 3. Bestehende Abhängigkeiten

- **Extern:** `mcp-handler`, `@modelcontextprotocol/sdk`, `zod` (MCP); `firebase-admin` (Admin-SDK,
  Transaktionen für Claim/Lease); `firebase` (Client-SDK, Live-Abos); `@tiptap/*` (Editor/Render).
  **Neu nötig:** ein Markdown-Parser/-Serializer (oder Eigenbau) für die Body-Konvertierung.
- **Intern (Parität!):** `data.ts` muss die Constraints aus `firestore.rules` **selbst** erzwingen
  (Admin-SDK umgeht die Regeln). `firebaseUtils` ↔ Regeln (`modifiedBy`, `tags`/`mentions`).
  `TodosContext` ↔ `firebaseUtils`. Markdown→Tiptap ↔ die in `useTiptapConfig` erlaubten Typen
  (sonst rendert/serialisiert der Body inkonsistent).

## 4. Bekannte Einschränkungen

- **Admin-SDK umgeht die Regeln** → jede neue Schreiblogik in `data.ts` muss die Regeln spiegeln;
  neue Felder müssen in **beiden** Welten validiert werden (Muster aus #71/#198).
- **Stateless/Serverless** → keine serverseitige Session-Speicherung über Requests hinweg; die
  Session-Identität muss pro Request **herleitbar** sein (host+cwd) — passt zum Konzept, ist aber
  zwingend.
- **Kein serverseitiges Tiptap, keine Markdown-Lib** → Konvertierung ist Neubau und
  XSS-sensibel (nur erlaubte Nodes, Links durch `linkSecurity`).
- **Kein Index-Setup** (`firestore.indexes.json` fehlt, kein `collectionGroup`) → `next-todo`
  erfordert neue Index-Infrastruktur + Deploy.
- **Inline-`code` deaktiviert** (`code:false`) → Markdown-Inline-Code muss bewusst behandelt werden
  (Extension aktivieren **oder** auf Codeblock mappen) — Entscheidung in der Spezifikation.
- **Rate-Limit 30 Writes/min/uid, pro Instanz** → ein enger `/loop` (`next-todo` claimt = Write)
  kann anlaufen; Loop-Takt muss das respektieren bzw. `next-todo`-Claim ggf. vom Write-Limit
  ausnehmen/separat takten.
- **„Session" ist semantisch belegt** (Geräte-Login) → konsequent abweichende Benennung nötig.

## 5. Risiken bei Änderung

- **Regel-/Code-Parität bricht:** Neue Todo-Felder ohne gleichzeitige Regel-Validierung erlauben
  entweder Hostile-Writes (unvalidiert) oder brechen bestehende Clients (zu strenge Shape-Checks
  auf Teil-Updates, die in die volle Doc-Form mergen). → Regeln + Tests **im selben Schritt**.
- **Claim/Lease-Races:** `next-todo` schreibt beim Lesen (Claim). Ohne **Transaktion** könnten zwei
  Aufrufe dasselbe Todo claimen oder ein abgelaufener Lease inkonsistent überschrieben werden.
- **Cross-Space-Leak:** Der `collectionGroup`-Query über `attachedSession` trifft Todos in **allen**
  Spaces. Da Admin die Regeln umgeht, muss jeder Treffer **gegen aktuelle Mitgliedschaft** geprüft
  werden (z.B. nach Verlassen eines Space), sonst liest/bearbeitet der Loop Fremd-Todos.
- **XSS/Body-Integrität:** Eine schlecht gebaute Markdown→Tiptap-Konvertierung könnte unerlaubte
  Nodes/Attribute oder ungeprüfte Links erzeugen. Der Render-Pfad muss `<EditorContent>` bleiben
  (nie `dangerouslySetInnerHTML`/`generateHTML`).
- **UX-Verwechslung:** „Sessions" in den Settings ohne klare Abgrenzung zu Geräte-Login-Sessions.
- **Lease-TTL-Read:** Konfigurierbarer TTL bedeutet einen zusätzlichen Settings-Read beim Claim
  (oder Caching) — kleiner, aber zu bedenkender Overhead.

## 6. Referenzen

- [Konzept](01-konzept-aido-sessions.md)
- Verwandtes Konzept (Push-Weg): [Claude Code Channels](01-konzept-claude-code-channels.md)
