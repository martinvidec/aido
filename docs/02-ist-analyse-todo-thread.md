# Ist-Analyse: Chat-Thread pro Todo

## 1. Aktueller Zustand

### 1.1 Wie „Konversation" heute entsteht

Ein Todo lebt unter `spaces/{spaceId}/todos/{todoId}` und trägt seinen Rich-Text im Feld `body` (Tiptap-JSON). Wird der Todo an eine aido-Session gehängt, bearbeitet Claude ihn über die MCP-Tools:

- `next-todo` **claimt** den ältesten offenen, an die Session gebundenen Todo (Transaktion + Lease) und liefert dessen Body als Markdown zurück.
- `update-todo` schreibt eine Antwort. Im Default-Modus **`append`** ruft es `appendAnswer(existingBody, answerMarkdown, …)` auf (`src/lib/tiptap/markdown.ts`), das einen fetten Markierungs-Absatz „💬 Antwort von aido · {Zeit}" plus den konvertierten Antworttext **hinten an den bestehenden Body anhängt**.
- `handoff` gibt den Todo **offen** an den Menschen zurück und **löst die Session-Bindung** (`attachedSession`/`aidoTurn`/`claimedBy`/`claimedAt = null`).

Jede Nachbesserungs-Runde hängt so einen weiteren Block an denselben `body`. Es gibt **keinen** separaten Nachrichten-Speicher und **keine** Absender-/Zeit-strukturierte Konversation außer den eingefügten Markierungs-Absätzen. Genau das macht den Body unübersichtlich.

### 1.2 Was als Vorbild bereits existiert

- Die **`daily`-Subcollection** (`spaces/{spaceId}/daily`) ist ein sauberer, minimaler Präzedenzfall für eine space-gebundene Subcollection mit eigenem Rules-Block, eigenem Live-Abo (`DailyContext`) und CRUD-Helfern.
- Die **Tiptap-Konfiguration** (`useTiptapConfig`) und die Komponenten `TodoEditor` (Composer) / `TodoBody` (read-only Renderer) sind so aufgebaut, dass sie sich für einen Thread-Composer/-Renderer wiederverwenden lassen.
- Das **MCP-Session-Modell** (`register-session`, claim/lease via `requireClaim`, Tool-Allowlist via `assertToolAllowed`) liefert das fertige Sicherheitsgerüst für ein neues, aido-schreibbares Thread-Tool.

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `firestore.rules` | Autorität des Datenmodells. Helfer `isMemberOfThisSpace()`/`thisSpaceMembers()` in `match /spaces/{spaceId}`; `todos`-Block (Z. 117–189) und `daily`-Block (Z. 193–214). | **Hoch** — neuer `messages`-Block wird hier ergänzt, erbt die Space-Helfer. |
| `tests/firestore-rules.test.mjs` | Rules-Tests; Abschnitt „Space todos & daily" (Z. ~262–448), `resetSpaceTodos()`-Fixture. | **Hoch** — neuer Testblock analog `daily`. |
| `src/lib/types.ts` | `Todo` (Z. 32–79), `Daily` (Z. 86–96), `TiptapContent` (Z. 25), `AgentToolName` (Z. 99), `AgentSession` (Z. 107–123). | **Hoch** — neues `ThreadMessage`; `AgentToolName` erweitern. |
| `src/lib/tiptap/markdown.ts` | `markdownToTiptap`, `tiptapToMarkdown`, `appendAnswer`. Server-sicher (`markdown-it`). | **Hoch** — Konvertierung für das Thread-Tool wiederverwenden; `appendAnswer`-Nutzung im aido-Flow löst sich teilweise ab. |
| `src/lib/hooks/useTiptapConfig.ts` | Liefert `{extensions, editorProps}`; Mentions aus **Kontakten** (`getContacts`), Hashtags, Link-Sicherheit, Task-Listen. | **Hoch** — Composer erbt Fähigkeiten; **Mention-Quelle muss auf Space-Mitglieder umstellbar** werden. |
| `src/components/shell/list/TodoEditor.tsx` | Editierbarer Composer (Titel + Body, Toolbar). | **Hoch** — Vorlage für `ThreadComposer` (ohne Titel). |
| `src/components/shell/list/TodoBody.tsx` | Read-only Renderer (XSS-sicherer ProseMirror-Pfad, Checklist-Echo-Suppression). | **Hoch** — Vorlage für `ThreadMessage`-Renderer (ohne Checklist-Rückschreiben). |
| `src/components/shell/list/TodoRow.tsx` | Aufgeklappte Zeile; rendert `TodoBody`/`TodoActions`. | **Hoch** — Einhängepunkt für das Thread-Panel. |
| `src/components/shell/list/ComposerToolbar.tsx`, `@/components/SuggestionList` | Format-Toolbar bzw. Mention-Dropdown. | **Mittel** — direkt wiederverwendbar. |
| `src/lib/contexts/DailyContext.tsx` | `onSnapshot`-Abo je Space + CRUD. | **Hoch** — Muster für `useTodoThread(spaceId, todoId)`. |
| `src/lib/contexts/TodosContext.tsx` | Todo-Abo/CRUD; `mentionMembers` aus Space-Mitgliedern (Z. ~99–106). | **Hoch** — `mentionMembers` ist die gewünschte Thread-Mention-Quelle. |
| `src/lib/firebase/firebaseUtils.ts` | `todosCol`/`todoRef`, `subscribeTodosForSpace` (Muster `onSnapshot(query(col, orderBy…))`). | **Hoch** — neue `messagesCol`/`subscribeThread`/`postThreadMessage`/`deleteThreadMessage`. |
| `src/lib/mcp/data.ts` | Admin-SDK-Datenzugriff; `requireMember`, `requireSession`, `assertToolAllowed`, `requireClaim`, `nextTodo`, `updateTodo`, `handoffTodo`. `ALL_AGENT_TOOLS`/`DEFAULT_ALLOWED_TOOLS`. | **Hoch** — `postMessage`/`listMessages`; ggf. Thread in `nextTodo`. |
| `src/lib/mcp/tool-logic.ts` | Dünne Handler; `requireUserUid`, `enforceWriteRateLimit` (30/min). | **Hoch** — neue Handler + Rate-Limit. |
| `src/app/api/mcp/sse/route.ts` | Tool-Registrierung (`server.tool(name, desc, zodShape, handler)`), `safe()`. | **Hoch** — neues Tool registrieren. |
| `src/lib/mcp/auth.ts`, `context.ts` | Principal-Bindung (`AsyncLocalStorage`), API-Key/OAuth/Shared-Token. | **Niedrig** — unverändert; das neue Tool nutzt denselben `user`-Principal-Pfad. |
| `tests/mcp-tools.test.mts` | MCP-Tool-Tests gegen den Emulator (Admin-SDK); testet `updateTodo` append/replace (Z. ~180–187). | **Hoch** — Abdeckung des neuen Thread-Tools. |
| `docs/01-konzept-claude-code-channels.md` | **Unrelated** — Push-/Event-Bridge („Channels"), nicht dieser Thread. | **Nur Namensabgrenzung.** |

## 3. Bestehende Abhängigkeiten

**Intern**
- Rules-Helfer `isMemberOfThisSpace()`/`thisSpaceMembers()` sind an `match /spaces/{spaceId}` gebunden — der neue Block muss dort verschachtelt liegen, um sie zu erben.
- `useTiptapConfig` kapselt die Editor-Fähigkeiten; sowohl Todo- als auch Thread-Editor hängen daran. Eine Änderung an der Mention-Quelle muss die bestehende Todo-Nutzung unangetastet lassen.
- MCP-Datenpfad `data.ts` spiegelt die Rules selbst (Admin-SDK umgeht sie) — jede neue Schreiboperation muss Mitgliedschaft/Claim/Shape dort erneut prüfen.

**Extern**
- Firebase (Firestore Client-SDK + `firebase-admin`), Tiptap/ProseMirror, `markdown-it`, `mcp-handler` (stateless streamable-HTTP), Zod. Alle bereits im Projekt vorhanden — **keine neuen Laufzeit-Abhängigkeiten** zu erwarten.

## 4. Bekannte Einschränkungen

- **Admin-SDK umgeht Rules:** aido-Schreibzugriffe werden nicht durch `firestore.rules` geschützt, sondern müssen in `data.ts` (Mitgliedschaft, Claim-Scope, Feld-Shapes) selbst abgesichert werden — analog `updateTodo`.
- **MCP-Server ist stateless:** keine dauerhafte Session-Server-State; `sessionId` ist deterministisch aus `spaceId|hostname|workingFolder`. Ein Thread-Tool muss (wie `update-todo`) `requireSession`+`requireClaim` je Request durchlaufen.
- **Rate-Limit ist per Serverless-Instanz** (Fixed-Window, `enforceWriteRateLimit`, 30/min pro uid) — kein global konsistentes Limit; ausreichend als Missbrauchsschutz, aber nicht exakt.
- **Mention-Suggestions sind heute kontaktbasiert**, nicht space-basiert — die gewünschte Space-Mitglieder-Quelle erfordert eine gezielte Erweiterung von `useTiptapConfig` (neuer Options-Zweig), ohne den Todo-Pfad zu verändern.
- **Rules validieren auch Updates vollständig** (Partial-Merge re-validiert den ganzen Doc) — die `messages`-Feld-Shapes müssen so gewählt sein, dass ein späterer Client-Merge (z. B. Löschen/Toggle) gültig bleibt.
- **Legacy-Wildcard `/{path=**}/todos/{todoId}`** ist auf `path[0] == 'users'` beschränkt und greift daher **nicht** auf `spaces/.../messages` — kein latentes Leseleck, aber es existiert auch **kein** Auto-Read für andere Subcollections; ein expliziter Block ist zwingend.

## 5. Risiken bei Änderung

- **Sicherheits-Scope des aido-Tools:** Ohne `requireClaim` könnte ein manipulierter Todo-Body Claude dazu bringen, in fremde Threads zu schreiben. Der Claim-Scope (nur der geclaimte Todo) und die Tool-Allowlist müssen strikt greifen — wie bei `update-todo`.
- **Mention-Quelle:** Eine falsche Änderung an `useTiptapConfig` könnte die **Todo**-Mentions (Kontakte) unbeabsichtigt mit-umstellen. Die Erweiterung muss additiv/optional sein.
- **Rules-Lücke:** Ein fehlender oder zu laxer `messages`-Block würde entweder Zugriff verwehren (Feature kaputt) oder Nicht-Mitgliedern Zugriff geben (Leck). Rules-Tests sind Pflicht und müssen zusammen mit der Rule geändert werden (CLAUDE.md-Regel).
- **UI-Performance:** Ein Thread-Abo pro aufgeklapptem Todo ist unkritisch; würde man Threads für viele Zeilen gleichzeitig abonnieren, drohen viele `onSnapshot`-Listener. MVP abonniert nur die geöffnete Zeile.
- **Deploy-Reihenfolge:** Neue Rules erst nach dem Client deployen, wenn der alte Client sonst auf der neuen Subcollection scheitern würde (CLAUDE.md). Da die Subcollection neu und additiv ist, ist das Risiko gering; Reihenfolge dennoch beachten.
- **Semantik-Bruch im aido-Flow:** Wird `update-todo` künftig „nur Ergebnis" statt „Konversation", müssen die Tool-Beschreibungen und der `/loop`-Ablauf (bzw. das geplante Plugin, Issue #245) angepasst werden, sonst schreibt aido weiter in den Body.
