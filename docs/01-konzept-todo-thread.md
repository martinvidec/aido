# Konzept: Chat-Thread pro Todo

## 1. Zusammenfassung

Jeder Todo erhält einen eigenen Diskussions-**Thread**, getrennt vom Todo-Body. In diesem Thread können alle **Space-Mitglieder** sowie alle für den Space **registrierten aido-MCP-Sessions** Nachrichten schreiben und lesen. Der Thread-Editor besitzt dieselben Rich-Text-Fähigkeiten wie der Todo-Editor (Tiptap, Tags, Mentions). Damit wandert die heute im Todo-Body entstehende Konversation (Rückfragen/Nachbesserungen zwischen Mensch und aido) in einen separaten, chronologischen Nachrichtenstrom, während der Todo-Body die eigentliche Aufgabenbeschreibung sauber und übersichtlich hält.

## 2. Problemstellung

Ein Todo kann an eine aido-Session gehängt werden; Claude bearbeitet es dann über die MCP-Tools und schreibt seine Antworten via `update-todo` **an das Ende des Todo-Bodys** (`appendAnswer` in `src/lib/tiptap/markdown.ts`, Markierung „💬 Antwort von aido …"). Sobald nachgebessert werden muss, entsteht ein Hin und Her aus Fragen und Antworten, das ebenfalls immer weiter unten an den Body angehängt wird. Folge:

- Der Todo-Body wird zunehmend **unübersichtlich** — Aufgabenbeschreibung, Zwischenstände und Konversation vermischen sich in einem einzigen Rich-Text-Dokument.
- Es gibt keine klare Trennung zwischen „**Was ist zu tun**" (Body) und „**Worüber reden wir gerade**" (Konversation).
- Der Verlauf ist nicht als Konversation erkennbar (kein Absender-/Zeit-Strukturierung außer den eingefügten Markierungs-Absätzen).

## 3. Zielsetzung

- **Trennung von Aufgabe und Diskussion:** Der Todo-Body bleibt die Aufgabenbeschreibung; die Konversation lebt im Thread.
- **Kollaboration im Kontext:** Space-Mitglieder und die dem Space zugeordneten aido-Sessions diskutieren pro Todo an einem Ort.
- **Gleiche Editor-Fähigkeiten wie Todos:** Tiptap mit Tags (`#`), Mentions (`@`), Formatierung, Codeblöcken, sicheren Links.
- **Mensch↔aido-Nachbesserungs-Schleife:** aido kann Rückfragen in den Thread stellen und an den Menschen übergeben; der Mensch antwortet im Thread; aido nimmt den Todo wieder auf und liest den Thread-Verlauf als Kontext.
- **Messbar:** Neue Rückfragen landen zu 100 % im Thread statt im Body; der Todo-Body wächst durch Konversation nicht mehr an.

## 4. Lösungsidee

### 4.1 Datenhaltung

Neue Firestore-Subcollection **`spaces/{spaceId}/todos/{todoId}/messages/{messageId}`** (Arbeitsname „messages"; **nicht** „channels", um Namenskollision mit `docs/01-konzept-claude-code-channels.md` zu vermeiden). Sie sitzt neben `todos`/`daily` innerhalb von `match /spaces/{spaceId}` und nutzt die vorhandenen Rules-Helfer `isMemberOfThisSpace()` / `thisSpaceMembers()` wieder — analog zum `daily`-Präzedenzfall.

Nachrichten-Shape (Entwurf):

| Feld | Typ | Bedeutung |
|---|---|---|
| `body` | `map \| null` | Rich-Text (Tiptap JSON), wie `todo.body` |
| `text` | `string` | Klartext-Extrakt (Vorschau/Suche/aido-Kontext) |
| `tags` | `string[]` | aus `#`-Hashtags abgeleitet |
| `mentions` | `string[]` | aus `@`-Mentions abgeleitet (uids) |
| `author` | `string` | uid des Verfassers, **unveränderlich** |
| `source` | `'user' \| 'aido'` | von Mensch oder aido-Session verfasst |
| `sessionId` | `string \| null` | falls von einer aido-Session verfasst |
| `createdAt` | `Timestamp` | Sortierschlüssel (chronologisch) |

### 4.2 Zugriff

- **Space-Mitglieder** schreiben/lesen über das Client-SDK; Firestore-Rules setzen Mitgliedschaft, unveränderlichen `author` und Feld-Shapes durch (Muster wie `daily`, kombiniert mit dem `createdBy`/`modifiedBy`-Ansatz der Todos, damit spätere Client-Merges gültig bleiben).
- **aido-MCP-Sessions** schreiben über den Admin-SDK-Pfad (umgeht Rules) mit einem neuen, session-gebundenen MCP-Tool. Wirkung bleibt durch **`requireClaim`** (Scope auf den geclaimten Todo) und die **Tool-Allowlist** der Session begrenzt — dasselbe Sicherheitsmodell wie `update-todo`/`handoff`.

### 4.3 Editor & UI

- **Wiederverwendung** von `useTiptapConfig` sowie einer abgespeckten Variante von `TodoEditor` (ohne Titel) als **Thread-Composer** und von `TodoBody` (read-only) als **Nachrichten-Renderer**. Tags/Mentions/Formatierung/Link-Sicherheit kommen dadurch „gratis" mit.
- **Platzierung:** Thread-Panel in der aufgeklappten Todo-Zeile (Liste) — genau dort, wo heute `TodoBody`/`TodoActions` sitzen. (Board-Detailansicht optional, siehe Abgrenzung.)
- **Live-Aktualisierung** via `onSnapshot`-Abo pro geöffnetem Todo (Hook `useTodoThread(spaceId, todoId)`), analog zu `DailyContext`.

### 4.4 aido-Arbeitsschleife (Ziel-Flow)

1. aido nimmt Todo auf (`next-todo`, claim+lease) und erhält Body **und** Thread-Verlauf als Markdown.
2. aido arbeitet; bei Rückfrage **postet es die Frage in den Thread** (neues Tool) und ruft **`handoff`** (Todo bleibt offen, Bindung gelöst).
3. Mensch sieht den Thread, **antwortet im Thread**, hängt den Todo wieder an die Session.
4. aido nimmt den Todo erneut auf, liest den neuen Thread-Verlauf und arbeitet weiter. Das **eigentliche Ergebnis** landet weiterhin im Body (`update-todo`), die **Konversation** im Thread.

## 5. Betroffene Komponenten

| Bereich | Datei(en) | Art der Änderung |
|---|---|---|
| Firestore-Rules | `firestore.rules` | neuer `messages`-Block in `match /spaces/{spaceId}` |
| Rules-Tests | `tests/firestore-rules.test.mjs` | neuer Testblock analog `daily` |
| Typen | `src/lib/types.ts` | `ThreadMessage`-Interface, ggf. neuer `AgentToolName` |
| Firestore-Helfer | `src/lib/firebase/firebaseUtils.ts` | `messagesCol`, `subscribeThread`, `postThreadMessage`, `deleteThreadMessage` |
| Daten-Flow | neuer Hook `useTodoThread` (analog `DailyContext`) | Abo + CRUD |
| UI | neu unter `src/components/shell/list/` (`ThreadPanel`, `ThreadMessage`, `ThreadComposer`) + Einhängen in `TodoRow` | Thread-Ansicht |
| MCP-Daten | `src/lib/mcp/data.ts` | `postMessage`, `listMessages`; ggf. Thread in `nextTodo` |
| MCP-Handler | `src/lib/mcp/tool-logic.ts` | Handler + `enforceWriteRateLimit` |
| MCP-Registrierung | `src/app/api/mcp/sse/route.ts` | neues Tool (Zod-Schema) |
| MCP-Session-Modell | `data.ts` (`ALL_AGENT_TOOLS`, Allowlist, register-session-Enum) | neues Tool aufnehmen |
| MCP-Tests | `tests/mcp-tools.test.mts` | Abdeckung des neuen Tools |

## 6. Abgrenzung

**Nicht** Teil dieser Anforderung:

- **Kein** Bezug zu „Claude Code Channels" (`docs/01-konzept-claude-code-channels.md`) — das ist ein Push-/Event-Bridge-Konzept; hier geht es um einen Diskussions-Thread. Nur die Namensgleichheit wird bewusst vermieden.
- **Kein** Space-weiter oder Todo-übergreifender Chat — der Thread ist strikt an einen Todo gebunden.
- **Keine** Migration bestehender, bereits in Bodys angehängter Konversationen in Threads (Bestand bleibt, wie er ist).
- **Kein** Bearbeiten fremder Nachrichten; Message-Editing generell zunächst außen vor (nur eigenes Löschen — siehe offene Frage).
- **Keine** Benachrichtigungen/E-Mails/Push oder Ungelesen-Zähler im MVP (Mentions werden nur gerendert). Optional als Folge-Ausbaustufe.
- **Keine** Reaktionen, Tipp-Indikatoren, Lesebestätigungen, Threads-in-Threads.

## 7. Getroffene Entscheidungen

Die anfänglich offenen Fragen wurden mit dem User geklärt:

1. **Mentions-Quelle im Thread:** **Space-Mitglieder** (nicht Kontakte). Die Liste liegt in `TodosContext` als `mentionMembers` bereits vor. → `useTiptapConfig` muss eine space-mitglieder-basierte Mention-Quelle unterstützen.
2. **aido-Flow & Tool-Zuschnitt:** **Neues, thread-gebundenes MCP-Tool** — aido postet Rückfragen in den Thread und liest den Thread-Verlauf beim Aufnehmen (`next-todo` bzw. dediziertes Lese-Tool) mit. `update-todo` schreibt künftig nur noch das **Ergebnis** in den Body; die Konversation bleibt im Thread.
3. **Eigene Nachrichten löschen:** **Ja**, Verfasser dürfen eigene Nachrichten löschen (analog `daily`). Message-**Editing** bleibt vorerst außen vor.
4. **Platzierung:** **MVP nur Listen-Ansicht** (aufgeklappte Todo-Zeile). Board-Detailansicht optional als spätere Ausbaustufe.
5. **Umsetzungsgröße:** **Epic mit Teil-Issues** (Rules+Tests / Editor+UI / MCP-Tools / Verdrahtung), da Frontend-, Backend- und Rules-Anteile klar trennbar sind.
