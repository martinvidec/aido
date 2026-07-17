# Spezifikation: Chat-Thread pro Todo

## 1. Übersicht

Umsetzung eines Diskussions-Threads pro Todo als neue Firestore-Subcollection `spaces/{spaceId}/todos/{todoId}/messages`, mit einem Rich-Text-Composer/-Renderer auf Basis der bestehenden Tiptap-Bausteine (Mentions aus **Space-Mitgliedern**), einem session- und claim-gebundenen MCP-Tool zum Posten durch aido sowie einer Erweiterung von `next-todo`, damit aido den Thread-Verlauf mitliest. Grundlage sind [Konzept](01-konzept-todo-thread.md), [Ist-Analyse](02-ist-analyse-todo-thread.md) und [Anforderungsanalyse](03-anforderungsanalyse-todo-thread.md).

## 2. Technisches Design

### 2.1 Architektur

- **Datenhaltung:** neue Subcollection unter dem Todo (nicht unter dem Space), damit ein Thread strikt an einen Todo gebunden ist und die Rules-Membership über den Space greift.
- **Client-Pfad:** Space-Mitglieder schreiben/lesen über das Client-SDK, geschützt durch neue Firestore-Rules; Live-Aktualisierung via `onSnapshot` pro geöffnetem Todo.
- **aido-Pfad:** aido-Sessions schreiben über den Admin-SDK-Pfad (`data.ts`), abgesichert durch `requireSession` → `assertToolAllowed` → `requireClaim`; das Sicherheitsmodell entspricht `update-todo`.
- **Editor:** zentrale `useTiptapConfig` wird additiv um eine wählbare Mention-Quelle erweitert; UI-Komponenten leiten sich von `TodoEditor`/`TodoBody` ab.

### 2.2 Datenmodell

**`spaces/{spaceId}/todos/{todoId}/messages/{messageId}`**

| Feld | Typ | Regel |
|---|---|---|
| `body` | `map \| null` | Tiptap-JSON (wie `todo.body`) |
| `text` | `string` | Klartext-Extrakt (Vorschau/Suche/aido-Kontext) |
| `tags` | `string[]` | aus `#`-Hashtags abgeleitet (optional) |
| `mentions` | `string[]` | aus `@`-Mentions abgeleitet, uids (optional) |
| `author` | `string` | uid des Verfassers, **unveränderlich** |
| `source` | `'user' \| 'aido'` | Client darf nur `'user'` erzeugen; `'aido'` nur über den Admin-Pfad |
| `sessionId` | `string \| null` | gesetzt, wenn von einer aido-Session verfasst |
| `createdAt` | `Timestamp` | `serverTimestamp()`; Sortierschlüssel (nicht shape-validiert, analog `daily`/`todos`) |

**TypeScript** (`src/lib/types.ts`):

```ts
export interface ThreadMessage {
  id: string;
  body: TiptapContent | null;
  text: string;
  tags: string[];
  mentions: string[];
  author: string;
  source: "user" | "aido";
  sessionId: string | null;
  createdAt: Timestamp | null;
}
// AgentToolName um "post-message" erweitern.
```

### 2.3 Firestore-Rules

Neuer Block, **verschachtelt in `match /todos/{todoId}`** (erbt `isMemberOfThisSpace()`/`thisSpaceMembers()` aus dem Space-Scope):

```
match /messages/{messageId} {
  function hasValidMessageFields() {
    return request.resource.data.author is string
        && request.resource.data.source in ['user', 'aido']
        && (!('body' in request.resource.data)
            || request.resource.data.body == null
            || request.resource.data.body is map)
        && (!('text' in request.resource.data) || request.resource.data.text is string)
        && (!('tags' in request.resource.data) || request.resource.data.tags is list)
        && (!('mentions' in request.resource.data) || request.resource.data.mentions is list)
        && (!('sessionId' in request.resource.data)
            || request.resource.data.sessionId == null
            || request.resource.data.sessionId is string);
  }

  allow read: if isMemberOfThisSpace();
  // Clients erzeugen nur eigene 'user'-Nachrichten; 'aido' entsteht nur über den
  // Admin-SDK-Pfad (der diese Rules umgeht) und kann daher nicht gefälscht werden.
  allow create: if isMemberOfThisSpace()
    && request.resource.data.author == request.auth.uid
    && request.resource.data.source == 'user'
    && hasValidMessageFields();
  // MVP: kein Editieren.
  allow update: if false;
  // Nur der Verfasser löscht seine eigene Nachricht.
  allow delete: if isMemberOfThisSpace() && resource.data.author == request.auth.uid;
}
```

`createdAt` wird — wie bei `todos`/`daily` — bewusst **nicht** shape-validiert (vermeidet `serverTimestamp()`-Reibung). `update: if false` macht die Autor-Unveränderlichkeit im MVP trivial erfüllt.

### 2.4 Schnittstellen

**Firestore-Helfer** (`src/lib/firebase/firebaseUtils.ts`):

```ts
messagesCol(spaceId, todoId)                         // collection ref
subscribeThread(spaceId, todoId, onChange, onError)  // onSnapshot(query(col, orderBy('createdAt','asc')))
postThreadMessage(spaceId, todoId, { body, text, tags, mentions, author })  // source:'user', createdAt: serverTimestamp()
deleteThreadMessage(spaceId, todoId, messageId)
```

`tags`/`mentions` werden aus dem Tiptap-Doc mit **derselben Ableitung wie bei Todos** gewonnen.

**Hook** `useTodoThread(spaceId, todoId)` (analog `DailyContext`): abonniert beim Mount, gibt `{ messages, post, remove, loading, error }` zurück, löst das Abo beim Unmount.

**MCP-Tools** (neu bzw. erweitert):

| Tool | Signatur (Zod) | Verhalten |
|---|---|---|
| `post-message` | `{ sessionId, spaceId, todoId, bodyMarkdown }` | `requireSession` → `assertToolAllowed('post-message')` → `requireMember` → `requireClaim` → `markdownToTiptap` → Nachricht schreiben (`source:'aido'`, `sessionId`, `author=uid`). `enforceWriteRateLimit`. |
| `list-messages` | `{ spaceId, todoId }` | `requireMember` → Thread ordered lesen → als strukturierte Liste/Markdown zurück. (Soll) |
| `next-todo` (erweitert) | unverändert | Rückgabe zusätzlich um `thread` (Nachrichten als Markdown mit Absender/Zeit) erweitert, damit aido beim Aufnehmen Kontext hat. |

`AgentToolName`, `ALL_AGENT_TOOLS`, `DEFAULT_ALLOWED_TOOLS` und das `register-session`-`allowedTools`-Enum um `post-message` erweitern.

### 2.5 UI-Komponenten (`src/components/shell/list/`)

- **`useTiptapConfig`-Erweiterung:** additive Option für eine **Space-Mitglieder-Mention-Quelle** (z. B. `mentionCandidates`/`mentionSource`), die bei Angabe `getContacts` ersetzt. Default bleibt Kontakte → **Todo-Editor unverändert**.
- **`ThreadComposer`** — abgeleitet von `TodoEditor` **ohne Titelfeld**; `useTiptapConfig({ editable:true, mention: spaceMembers, currentUserId })` + `ComposerToolbar`. `save()` → `body=getJSON()` (oder null bei leer), Ableitung `text/tags/mentions`, `post(...)`.
- **`ThreadMessage`** — abgeleitet von `TodoBody` (read-only, **ohne** Checklist-Rückschreib-Logik); Kopf mit Absender (Anzeigename/Avatar via `useMemberProfiles`), Zeitstempel, aido-Badge bei `source==='aido'`, Löschen-Button nur für eigene Nachricht.
- **`ThreadPanel`** — nutzt `useTodoThread`; rendert Nachrichtenliste + `ThreadComposer`; wird in **`TodoRow`** in der aufgeklappten Zeile eingehängt.

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `firestore.rules` | `messages`-Block ergänzen | Klein |
| `tests/firestore-rules.test.mjs` | Testblock für `messages` | Mittel |
| `src/lib/types.ts` | `ThreadMessage`, `AgentToolName` | Klein |
| `src/lib/firebase/firebaseUtils.ts` | `messagesCol`/`subscribeThread`/`postThreadMessage`/`deleteThreadMessage` | Mittel |
| `useTodoThread`-Hook (neu) | Abo + CRUD | Mittel |
| `useTiptapConfig.ts` | wählbare Mention-Quelle (additiv) | Mittel |
| `ThreadComposer`/`ThreadMessage`/`ThreadPanel` (neu) + `TodoRow` | Thread-UI | Groß |
| `src/lib/mcp/data.ts` | `postMessage`, `listMessages`, `nextTodo`-Thread | Mittel |
| `src/lib/mcp/tool-logic.ts` | Handler + Rate-Limit | Klein |
| `src/app/api/mcp/sse/route.ts` | Tool-Registrierung | Klein |
| `tests/mcp-tools.test.mts` | Abdeckung `post-message`/`list-messages`/`next-todo` | Mittel |

### 3.2 Reihenfolge der Implementierung (= Epic-Teil-Issues)

1. **Datenmodell + Rules + Rules-Tests** — `ThreadMessage`-Typ, `messages`-Rules-Block, Tests. (Fundament)
2. **Firestore-Helfer + `useTodoThread`-Hook** — Datenschicht ohne UI.
3. **Editor-Erweiterung + Thread-UI** — Space-Member-Mentions in `useTiptapConfig`, `ThreadComposer`/`ThreadMessage`/`ThreadPanel`, Einhängung in `TodoRow`.
4. **MCP-Tools** — `post-message`, `list-messages`, `next-todo`-Thread, Session-Allowlist, MCP-Tests.
5. **aido-Flow scharfstellen** — `update-todo`/Tool-Beschreibungen: Ergebnis→Body, Konversation→Thread; Kopplung an Plugin-Issue #245.

## 4. Testplan

- **Rules-Tests** (`npm run test:rules`): Mitglied liest/schreibt; Nicht-Mitglied verweigert (read+create); `author==auth.uid` erzwungen; Client kann `source='aido'` nicht setzen; Löschen nur eigener Nachricht; Feld-Shapes (`body` map, `text` string, `tags`/`mentions` list).
- **MCP-Tests** (`npm run test:mcp`): `post-message` auf geclaimten Todo erfolgreich (`source='aido'`), auf nicht-geclaimten Todo `requireClaim`-Fehler; Tool nicht in Allowlist → `assertToolAllowed`-Fehler; `list-messages` liest Verlauf; `next-todo` enthält `thread`.
- **Manuell:** In der Listenansicht Nachricht mit Formatierung/`#`-Tag/`@`-Mention (Space-Mitglied) posten; Live-Update in zweitem Client; eigene Nachricht löschen; aido-Runde (Frage in Thread → `handoff` → Antwort → erneutes Aufnehmen liest Verlauf).

## 5. Migration / Deployment

- **Keine Datenmigration** — additive Subcollection; Bestands-Bodys bleiben unverändert.
- **Keine neue Env-Variable**, keine neue Laufzeit-Abhängigkeit.
- **Deploy-Reihenfolge:** App (Vercel) zuerst, dann `npx -y firebase-tools@13 deploy --only firestore:rules`. Da die Subcollection neu und additiv ist, bricht der alte Client nicht; Reihenfolge dennoch einhalten (CLAUDE.md).

## 6. Referenzen

- [Konzeptdokument](01-konzept-todo-thread.md)
- [Ist-Analyse](02-ist-analyse-todo-thread.md)
- [Anforderungsanalyse](03-anforderungsanalyse-todo-thread.md)
- Verwandt: Agent-Sessions (Epic #212), Polling-Loop → aido-Claude-Plugin (Issue #245), Namensabgrenzung zu `docs/01-konzept-claude-code-channels.md`.
